/**
 * adapters/http.ts — HTTP Server 适配器
 *
 * 将 AgentEngine 暴露为 HTTP 服务：
 *   - SSE 推流 StreamEvent（消息流、工具调用、错误等）
 *   - REST 接收 UserInput
 *   - 权限弹窗通过 pending promise 机制与前端同步
 *
 * 不依赖任何框架，使用 Node.js 内置 http 模块。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type {
  PermissionRequest,
  PermissionResponse,
  StreamEvent,
  ToolResult,
  UIAdapter,
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

/** AskUser 等待用户通过 POST /ask 返回 */
interface PendingAsk {
  sessionId: string
  resolve: (answer: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class HttpServerAdapter implements UIAdapter {
  private connections = new Map<string, SSEConnection>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private permissionCounter = 0
  private pendingAsks = new Map<string, PendingAsk>()
  private askCounter = 0

  // SSE 连接注册（由 HTTP handler 调用）
  registerConnection(sessionId: string, res: ServerResponse, abortController: AbortController): void {
    this.connections.set(sessionId, { res, sessionId, abortController })
    res.on('close', () => {
      this.connections.delete(sessionId)
      this.rejectAsksForSession(sessionId, new Error('SSE connection closed'))
    })
  }

  private rejectAsksForSession(sessionId: string, err: Error): void {
    for (const [id, p] of this.pendingAsks) {
      if (p.sessionId === sessionId) {
        clearTimeout(p.timer)
        p.reject(err)
        this.pendingAsks.delete(id)
      }
    }
  }

  /**
   * 由 server 的 runAgentLoop 注入 askUser：向当前 SSE 客户端推送 ask_user 并等待回复
   */
  requestAskUser(
    sessionId: string,
    question: string,
    options?: Array<{ id: string; label: string }>,
  ): Promise<string> {
    if (!this.connections.get(sessionId)) {
      return Promise.reject(new Error('No active SSE for session'))
    }
    return new Promise((resolve, reject) => {
      const requestId = `ask_${++this.askCounter}`
      const timer = setTimeout(() => {
        this.pendingAsks.delete(requestId)
        reject(new Error('AskUser timed out'))
      }, 120_000)
      this.pendingAsks.set(requestId, { sessionId, resolve, reject, timer })
      this.send(sessionId, 'ask_user', { requestId, question, options: options || [] })
    })
  }

  /** POST /api/sessions/:id/ask 调用 */
  resolveAskUser(requestId: string, response: { answer: string }): boolean {
    const p = this.pendingAsks.get(requestId)
    if (!p) return false
    clearTimeout(p.timer)
    this.pendingAsks.delete(requestId)
    p.resolve((response?.answer || '').trim() || '(empty)')
    return true
  }

  // 发送 SSE 事件
  private send(sessionId: string, event: string, data: unknown): void {
    const conn = this.connections.get(sessionId)
    if (!conn || conn.res.writableEnded) return
    const json = JSON.stringify(data)
    conn.res.write(`event: ${event}\ndata: ${json}\n\n`)
  }

  // ── UIAdapter 接口 ──

  onStreamEvent(event: StreamEvent): void {
    // sessionId 从 res headers 读取（由 handler 设置）
    for (const [sessionId, conn] of this.connections) {
      if (!conn.res.writableEnded) {
        this.send(sessionId, event.type, event)
      }
    }
  }

  /** 精确发送到指定 session */
  sendToSession(sessionId: string, event: StreamEvent): void {
    this.send(sessionId, event.type, event)
  }

  onToolStart(toolName: string, input: Record<string, unknown>): void {
    for (const sessionId of this.connections.keys()) {
      this.send(sessionId, 'tool_start', { toolName, input })
    }
  }

  onToolEnd(toolName: string, result: ToolResult): void {
    for (const sessionId of this.connections.keys()) {
      this.send(sessionId, 'tool_end', { toolName, output: result.data })
    }
  }

  onError(error: Error): void {
    for (const sessionId of this.connections.keys()) {
      this.send(sessionId, 'error', { message: error.message })
    }
  }

  async *getUserInput(): AsyncGenerator<string> {
    // HTTP 模式不使用 getUserInput（每次 POST /chat 启动一个完整循环）
  }

  async requestPermission(request: PermissionRequest): Promise<PermissionResponse> {
    const requestId = `perm_${++this.permissionCounter}`

    // 向所有连接推送权限请求
    for (const sessionId of this.connections.keys()) {
      this.send(sessionId, 'permission_request', {
        requestId,
        toolName: request.tool.name,
        input: request.input,
        message: 'message' in request.permissionResult ? request.permissionResult.message : '',
        riskLevel: 'riskLevel' in request.permissionResult ? request.permissionResult.riskLevel : 'medium',
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
    this.rejectAsksForSession(sessionId, new Error('Session ended'))
    const conn = this.connections.get(sessionId)
    if (conn && !conn.res.writableEnded) {
      this.send(sessionId, 'session_end', { sessionId })
      conn.res.end()
    }
    this.connections.delete(sessionId)
  }
}
