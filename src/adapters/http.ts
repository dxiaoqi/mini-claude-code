/**
 * adapters/http.ts — HTTP Server 适配器
 *
 * 将 AgentEngine 暴露为 HTTP 服务：
 *   - SSE 推流 UIEvent（统一命名：namespace.verb 点号风格）
 *   - REST 接收 UserInput
 *   - 权限弹窗通过 pending promise 机制与前端同步
 *
 * StreamEvent（引擎内部）→ UIEvent（SSE wire format）翻译在 sendToSession 中完成。
 * think.start / think.end 由此处自动注入，引擎无需感知。
 */

import type { ServerResponse } from 'node:http'
import type {
  PermissionRequest,
  PermissionResponse,
  StreamEvent,
  ToolResult,
  UIAdapter,
  UIEvent,
} from '../types.js'

/** 一个 SSE 连接：对应一次 /chat 请求的 response */
interface SSEConnection {
  res: ServerResponse
  sessionId: string
  abortController: AbortController
}

/** 等待前端回复的权限请求 */
interface PendingPermission {
  request: PermissionRequest
  resolve: (response: PermissionResponse) => void
}

export class HttpServerAdapter implements UIAdapter {
  private connections = new Map<string, SSEConnection>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private permissionCounter = 0
  /** Per-session think block tracking for think.start / think.end injection */
  private thinkingActive = new Map<string, boolean>()
  /** Per-session visual block counter for unique IDs */
  private visualCounter = new Map<string, number>()

  // SSE 连接注册（由 HTTP handler 调用）
  registerConnection(sessionId: string, res: ServerResponse, abortController: AbortController): void {
    this.connections.set(sessionId, { res, sessionId, abortController })
    res.on('close', () => {
      this.connections.delete(sessionId)
      this.thinkingActive.delete(sessionId)
      this.visualCounter.delete(sessionId)
    })
  }

  // 发送 SSE 数据帧（type 嵌在 data JSON 中，前端只需读 data: 行）
  private send(sessionId: string, data: UIEvent): void {
    const conn = this.connections.get(sessionId)
    if (!conn || conn.res.writableEnded) return
    conn.res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // ── UIAdapter 接口 ──

  onStreamEvent(event: StreamEvent): void {
    for (const [sessionId, conn] of this.connections) {
      if (!conn.res.writableEnded) {
        const uiEvents = this.translateEvent(sessionId, event)
        for (const ue of uiEvents) this.send(sessionId, ue)
      }
    }
  }

  /** 精确发送到指定 session（主路径，由 createSessionAdapter 调用） */
  sendToSession(sessionId: string, event: StreamEvent): void {
    const uiEvents = this.translateEvent(sessionId, event)
    for (const ue of uiEvents) this.send(sessionId, ue)
  }

  /** 直接发送已格式化的 UIEvent（用于 permission.request 等特殊事件） */
  sendUIEvent(sessionId: string, event: UIEvent): void {
    this.send(sessionId, event)
  }

  /** Translate one StreamEvent into one or more UIEvents, injecting think.start/end as needed */
  private translateEvent(sessionId: string, event: StreamEvent): UIEvent[] {
    const results: UIEvent[] = []
    const wasThinking = this.thinkingActive.get(sessionId) || false

    // End a think block when transitioning to a non-thinking event
    if (wasThinking && event.type !== 'thinking_delta') {
      results.push({ type: 'think.end' })
      this.thinkingActive.set(sessionId, false)
    }

    switch (event.type) {
      case 'text_delta':
        results.push({ type: 'text.delta', text: event.text })
        break

      case 'thinking_delta':
        if (!wasThinking) {
          results.push({ type: 'think.start' })
          this.thinkingActive.set(sessionId, true)
        }
        results.push({ type: 'think.delta', text: event.thinking })
        break

      case 'tool_use_start':
        results.push({ type: 'tool.start', id: event.id, name: event.name, input: event.input })
        break

      case 'tool_use_delta':
        results.push({ type: 'tool.delta', id: event.id, partialInput: event.partialInput })
        break

      case 'tool_result': {
        // artifacts 모드에서 Agent tool 결과에 <visual> 블록이 있으면 별도 UIEvent로 emit
        if (event.toolName === 'Agent' && typeof event.result === 'string') {
          const visualEvents = extractVisualBlocks(event.result, sessionId, this.visualCounter)
          results.push(...visualEvents)
        }
        results.push({
          type: 'tool.result',
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          result: event.result,
          isError: event.isError,
        })
        break
      }

      case 'message_start':
        results.push({ type: 'message.start', messageId: event.messageId, model: event.model })
        break

      case 'message_end':
        results.push({ type: 'message.end', usage: event.usage, stopReason: event.stopReason })
        break

      case 'turn_complete':
        results.push({ type: 'turn.complete', turnCount: event.turnCount, usage: event.usage })
        break

      case 'session_complete':
        results.push({ type: 'session.complete', reason: event.reason })
        break

      case 'agent_spawn':
        results.push({ type: 'agent.spawn', agentId: event.agentId, prompt: event.prompt })
        break

      case 'agent_complete':
        results.push({ type: 'agent.complete', agentId: event.agentId, result: event.result, usage: event.usage })
        break

      case 'compact':
        results.push({
          type: 'compact',
          tokensBefore: event.tokensBefore,
          tokensAfter: event.tokensAfter,
          tokensFreed: event.tokensFreed,
          strategies: event.strategies,
        })
        break

      case 'error':
        results.push({ type: 'error.occurred', message: event.error.message })
        break
    }

    return results
  }

  onToolStart(_toolName: string, _input: Record<string, unknown>): void {
    // no-op: tool.start is already emitted via onStreamEvent → tool_use_start
  }

  onToolEnd(_toolName: string, _result: ToolResult): void {
    // no-op: tool.result is already emitted via onStreamEvent → tool_result
  }

  onError(error: Error): void {
    for (const sessionId of this.connections.keys()) {
      this.send(sessionId, { type: 'error.occurred', message: error.message })
    }
  }

  async *getUserInput(): AsyncGenerator<string> {
    // HTTP 模式不使用 getUserInput（每次 POST /chat 启动一个完整循环）
  }

  async requestPermission(request: PermissionRequest): Promise<PermissionResponse> {
    const requestId = `perm_${++this.permissionCounter}`

    // 向所有连接推送权限请求（UIEvent 格式）
    for (const sessionId of this.connections.keys()) {
      this.send(sessionId, {
        type: 'permission.request',
        requestId,
        toolName: request.tool.name,
        input: request.input,
        message: 'message' in request.permissionResult ? String(request.permissionResult.message ?? '') : '',
        riskLevel: 'riskLevel' in request.permissionResult ? String(request.permissionResult.riskLevel ?? 'medium') : 'medium',
      })
    }

    // 等待前端回复（超时 120 秒自动拒绝）
    return new Promise<PermissionResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(requestId)
        resolve({ decision: 'deny' })
      }, 120_000)

      this.pendingPermissions.set(requestId, {
        request,
        resolve: (response) => {
          clearTimeout(timer)
          this.pendingPermissions.delete(requestId)
          resolve(response)
        },
      })
    })
  }

  /** 前端调用 POST /permission/:requestId/respond 后触发 */
  resolvePermission(requestId: string, response: PermissionResponse): boolean {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return false
    pending.resolve(response)
    return true
  }

  /** 结束指定 session 的 SSE 连接 */
  endSession(sessionId: string): void {
    const conn = this.connections.get(sessionId)
    if (conn && !conn.res.writableEnded) {
      this.send(sessionId, { type: 'session.end', sessionId })
      conn.res.end()
    }
    this.connections.delete(sessionId)
    this.thinkingActive.delete(sessionId)
    this.visualCounter.delete(sessionId)
  }
}

/**
 * 从 Agent tool result 字符串中提取 <visual type="...">...</visual> 块，
 * 转换为 block.visual_start + block.visual UIEvent 对。
 * 仅在 artifacts 모드（result 包含 <visual> 태그）에서 동작합니다.
 */
function extractVisualBlocks(
  result: string,
  sessionId: string,
  counterMap: Map<string, number>,
): UIEvent[] {
  const events: UIEvent[] = []
  const visualRegex = /<visual\s+type=["']([^"']+)["'][^>]*>([\s\S]*?)<\/visual>/gi
  let match: RegExpExecArray | null

  while ((match = visualRegex.exec(result)) !== null) {
    const visualType = match[1]
    const content = match[2]
    const count = (counterMap.get(sessionId) ?? 0) + 1
    counterMap.set(sessionId, count)
    const blockId = `agent_v${sessionId.slice(-6)}_${count}`

    events.push({ type: 'block.visual_start', blockId, visualType })
    events.push({ type: 'block.visual', blockId, visualType, content })
  }

  return events
}
