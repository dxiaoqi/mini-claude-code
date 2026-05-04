import type { UIEvent } from '../../types.js'

// ── Claude Code stream-json 原始事件类型 ──────────────────────────────────────

interface CCSystemInit {
  type: 'system'
  subtype: 'init'
  session_id: string
  data: { model?: string; tools?: string[] }
}

interface CCStreamEvent {
  type: 'stream_event'
  session_id?: string
  event: CCRawEvent
}

interface CCResult {
  type: 'result'
  subtype?: string
  session_id?: string
  result?: string
  is_error?: boolean
}

interface CCAssistant {
  type: 'assistant'
  message?: {
    content?: Array<{ type: string; id?: string; name?: string; input?: unknown }>
  }
}

interface CCUser {
  type: 'user'
  message?: {
    content?: Array<{
      type: string
      tool_use_id?: string
      content?: unknown
      is_error?: boolean
    }>
  }
  tool_use_result?: { stdout?: string; stderr?: string }
}

type CCRawEvent =
  | { type: 'message_start'; message: { id: string; model: string; usage?: { input_tokens: number } } }
  | { type: 'message_delta'; delta: { stop_reason: string }; usage?: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: 'content_block_start'; index: number; content_block: { type: string; id?: string; name?: string; text?: string } }
  | { type: 'content_block_delta'; index: number; delta: CCDelta }
  | { type: 'content_block_stop'; index: number }

type CCDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'input_json_delta'; partial_json: string }

// ── 翻译器 ────────────────────────────────────────────────────────────────────

export interface TranslatorResult {
  events: UIEvent[]
  /** system/init 时提取的 claude session_id */
  claudeSessionId?: string
  /** 检测到权限请求时的工具信息 */
  permissionRequest?: { toolName: string; toolId: string; input: unknown }
}

export class ClaudeCodeTranslator {
  private turnCount = 0
  private thinkingActive = false
  // index → tool info，用于 content_block_delta 时找到对应工具
  private activeBlocks = new Map<number, { type: string; id?: string; name?: string }>()
  // tool_use_id → name，跨 turn 保留供 tool.result 查找
  private toolIdToName = new Map<string, string>()

  translate(line: string): TranslatorResult {
    const result: TranslatorResult = { events: [] }
    if (!line.trim()) return result

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return result
    }

    const obj = parsed as Record<string, unknown>

    // ── system/init ──
    if (obj.type === 'system' && obj.subtype === 'init') {
      const init = obj as unknown as CCSystemInit
      result.claudeSessionId = init.session_id
      result.events.push({
        type: 'message.start',
        messageId: init.session_id,
        model: init.data?.model ?? 'claude',
      })
      return result
    }

    // ── result（最终结果行）──
    if (obj.type === 'result') {
      const r = obj as unknown as CCResult
      if (r.is_error) {
        result.events.push({ type: 'error.occurred', message: r.result ?? 'Claude Code error' })
      } else {
        result.events.push({ type: 'session.complete', reason: 'completed' })
      }
      return result
    }

    // ── assistant（权限请求检测）──
    if (obj.type === 'assistant') {
      const a = obj as unknown as CCAssistant
      const toolUse = a.message?.content?.find(b => b.type === 'tool_use')
      if (toolUse) {
        result.permissionRequest = {
          toolName: toolUse.name ?? 'unknown',
          toolId: toolUse.id ?? '',
          input: toolUse.input,
        }
      }
      return result
    }

    // ── user（工具结果）──
    if (obj.type === 'user') {
      const u = obj as unknown as CCUser
      const toolResults = u.message?.content?.filter(b => b.type === 'tool_result') ?? []
      for (const tr of toolResults) {
        if (!tr.tool_use_id) continue
        // find tool name from activeBlocks by matching stored id
        const toolName = [...this.activeBlocks.values()].find(b => b.id === tr.tool_use_id)?.name
          ?? this.toolIdToName.get(tr.tool_use_id)
          ?? 'unknown'
        const content = u.tool_use_result?.stdout ?? tr.content ?? ''
        result.events.push({
          type: 'tool.result',
          toolName,
          toolUseId: tr.tool_use_id,
          result: content,
          isError: tr.is_error ?? false,
        })
      }
      return result
    }

    // ── stream_event ──
    if (obj.type !== 'stream_event') return result
    const se = obj as unknown as CCStreamEvent
    const ev = se.event
    if (!ev) return result

    switch (ev.type) {
      case 'message_start': {
        // message.start 已在 system/init 发过，这里补充 model 信息
        result.events.push({
          type: 'message.start',
          messageId: ev.message.id,
          model: ev.message.model,
        })
        break
      }

      case 'content_block_start': {
        const cb = ev.content_block
        this.activeBlocks.set(ev.index, cb)

        if (cb.type === 'thinking') {
          this.thinkingActive = true
          result.events.push({ type: 'think.start' })
        } else if (cb.type === 'tool_use') {
          if (cb.id && cb.name) this.toolIdToName.set(cb.id, cb.name)
          result.events.push({
            type: 'tool.start',
            id: cb.id ?? `tool_${ev.index}`,
            name: cb.name ?? 'unknown',
            input: {},
          })
        }
        break
      }

      case 'content_block_delta': {
        const delta = ev.delta
        const block = this.activeBlocks.get(ev.index)

        if (delta.type === 'text_delta') {
          result.events.push({ type: 'text.delta', text: delta.text })
        } else if (delta.type === 'thinking_delta') {
          result.events.push({ type: 'think.delta', text: delta.thinking })
        } else if (delta.type === 'input_json_delta' && block?.id) {
          result.events.push({
            type: 'tool.delta',
            id: block.id,
            partialInput: delta.partial_json,
          })
        }
        break
      }

      case 'content_block_stop': {
        const block = this.activeBlocks.get(ev.index)
        if (block?.type === 'thinking' && this.thinkingActive) {
          this.thinkingActive = false
          result.events.push({ type: 'think.end' })
        }
        this.activeBlocks.delete(ev.index)
        break
      }

      case 'message_delta': {
        result.events.push({
          type: 'message.end',
          usage: { inputTokens: 0, outputTokens: ev.usage?.output_tokens ?? 0 },
          stopReason: ev.delta.stop_reason ?? 'end_turn',
        })
        break
      }

      case 'message_stop': {
        this.turnCount++
        result.events.push({
          type: 'turn.complete',
          turnCount: this.turnCount,
          usage: { inputTokens: 0, outputTokens: 0 },
        })
        break
      }
    }

    return result
  }

  reset(): void {
    this.turnCount = 0
    this.thinkingActive = false
    this.activeBlocks.clear()
    this.toolIdToName.clear()
  }
}
