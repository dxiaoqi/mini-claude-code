/**
 * Map backend Message[] (from /api/sessions/:id) to UI ChatMessage[].
 * Reconstructs ToolCallItem[] by pairing assistant tool_use with user tool_result blocks.
 */
import type { ChatMessage, ToolCallItem } from '@/components/MessageItem'
import { thinkingFromAssistantText } from '@/lib/redacted-thinking'

type ApiMsg = { role: string; content: unknown }

function toolResultBodyToPlainText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) {
    if (content && typeof content === 'object') {
      try {
        return JSON.stringify(content, null, 2)
      } catch {
        return String(content)
      }
    }
    return ''
  }
  const parts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (o.type === 'text' && typeof o.text === 'string') parts.push(o.text)
    else if (o.type === 'tool_result' && o.content !== undefined) {
      parts.push(toolResultBodyToPlainText(o.content))
    }
  }
  return parts.join('\n')
}

function parseAssistantBlocks(content: unknown): { content: string; toolCalls: ToolCallItem[]; thinkText?: string } {
  const textParts: string[] = []
  const toolCalls: ToolCallItem[] = []

  if (typeof content === 'string') {
    const { text, thinking } = thinkingFromAssistantText(content.trim())
    return { content: text, toolCalls: [], ...(thinking ? { thinkText: thinking } : {}) }
  }

  if (!Array.isArray(content)) return { content: '', toolCalls: [] }

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      textParts.push(b.text)
    } else if (b.type === 'tool_use' && typeof b.name === 'string' && typeof b.id === 'string') {
      const input = typeof b.input === 'object' && b.input !== null ? (b.input as Record<string, unknown>) : {}
      toolCalls.push({ id: b.id, name: b.name, input, status: 'running' })
    }
  }

  const rawText = textParts.join('\n\n').trim()
  const { text, thinking } = thinkingFromAssistantText(rawText)
  return {
    content: text,
    toolCalls,
    ...(thinking ? { thinkText: thinking } : {}),
  }
}

function userContentToParts(content: unknown): {
  userText: string
  results: Array<{ toolUseId: string; body: string; isError?: boolean }>
} {
  if (typeof content === 'string') {
    return { userText: content.trim(), results: [] }
  }
  if (!Array.isArray(content)) {
    return { userText: '', results: [] }
  }

  const textParts: string[] = []
  const results: Array<{ toolUseId: string; body: string; isError?: boolean }> = []

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      textParts.push(b.text)
    } else if (b.type === 'tool_result') {
      const id = typeof b.tool_use_id === 'string' ? b.tool_use_id : ''
      if (!id) continue
      results.push({
        toolUseId: id,
        body: toolResultBodyToPlainText(b.content),
        isError: b.is_error === true,
      })
    }
  }

  return {
    userText: textParts.join('\n\n').trim(),
    results,
  }
}

function applyToolResults(target: ChatMessage, results: Array<{ toolUseId: string; body: string; isError?: boolean }>): void {
  if (!target.toolCalls?.length || !results.length) return

  const next = target.toolCalls.map(t => ({ ...t }))
  for (const r of results) {
    const idx = next.findIndex(tc => tc.id === r.toolUseId)
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        status: r.isError ? 'error' : 'done',
        result: r.body,
        isError: r.isError,
      }
    }
  }
  for (let i = 0; i < next.length; i++) {
    if (next[i].status === 'running') {
      next[i] = { ...next[i], status: 'done', result: '—' }
    }
  }
  target.toolCalls = next
}

function sealRunningTools(msg: ChatMessage): void {
  if (!msg.toolCalls?.length) return
  msg.toolCalls = msg.toolCalls.map(t =>
    t.status === 'running' ? { ...t, status: 'done' as const, result: '—' } : t,
  )
}

/**
 * One user turn often produces multiple API `assistant` rows (tool round → model → tool round → …).
 * The live UI keeps a single bubble; history should match by folding adjacent assistant rows.
 */
function mergeConsecutiveAssistantRows(rows: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const row of rows) {
    if (row.role !== 'assistant') {
      out.push(row)
      continue
    }
    const prev = out[out.length - 1]
    if (prev?.role === 'assistant') {
      out[out.length - 1] = mergeAssistantPair(prev, row)
    } else {
      out.push({ ...row })
    }
  }
  return out
}

function mergeAssistantPair(a: ChatMessage, b: ChatMessage): ChatMessage {
  const toolCalls = [...(a.toolCalls ?? []), ...(b.toolCalls ?? [])]
  const content = [a.content, b.content].filter(s => s && s.trim()).join('\n\n').trim()
  const thinkText = [a.thinkText, b.thinkText].filter(Boolean).join('\n\n') || undefined
  const blocks = [...(a.blocks ?? []), ...(b.blocks ?? [])]
  const widgets = [...(a.widgets ?? []), ...(b.widgets ?? [])]
  const planPhases = [...(a.planPhases ?? []), ...(b.planPhases ?? [])]

  const next: ChatMessage = {
    ...a,
    id: a.id,
    content,
    timestamp: Math.min(a.timestamp, b.timestamp),
    isStreaming: false,
    artifactComplete: a.artifactComplete || b.artifactComplete,
  }
  if (toolCalls.length) next.toolCalls = toolCalls
  else delete next.toolCalls
  if (thinkText) next.thinkText = thinkText
  else delete next.thinkText
  if (blocks.length) next.blocks = blocks
  else delete next.blocks
  if (widgets.length) next.widgets = widgets
  else delete next.widgets
  if (planPhases.length) next.planPhases = planPhases
  else delete next.planPhases
  return next
}

export function apiMessagesToChatMessages(messages: ApiMsg[], sessionId: string): ChatMessage[] {
  const out: ChatMessage[] = []
  let lastAssistant: ChatMessage | null = null
  let idx = 0

  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue

    if (m.role === 'assistant') {
      const { content, toolCalls, thinkText } = parseAssistantBlocks(m.content)
      const chat: ChatMessage = {
        id: `sess_${sessionId.slice(0, 8)}_${idx}`,
        role: 'assistant',
        content,
        timestamp: Date.now() - (messages.length - idx) * 100,
        ...(toolCalls.length ? { toolCalls } : {}),
        ...(thinkText ? { thinkText } : {}),
      }
      out.push(chat)
      lastAssistant = chat
      idx += 1
      continue
    }

    const { userText, results } = userContentToParts(m.content)

    if (results.length > 0 && lastAssistant) {
      applyToolResults(lastAssistant, results)
    } else if (results.length > 0 && !lastAssistant) {
      // Orphan tool results (compact / odd transcripts): show as system-ish text on a synthetic assistant row
      out.push({
        id: `sess_${sessionId.slice(0, 8)}_${idx}`,
        role: 'assistant',
        content: results.map(r => r.body).join('\n\n'),
        timestamp: Date.now() - (messages.length - idx) * 100,
      })
      idx += 1
    }

    if (userText) {
      out.push({
        id: `sess_${sessionId.slice(0, 8)}_${idx}`,
        role: 'user',
        content: userText,
        timestamp: Date.now() - (messages.length - idx) * 100,
      })
      idx += 1
    }
  }

  for (const msg of out) {
    if (msg.role === 'assistant') sealRunningTools(msg)
  }

  return mergeConsecutiveAssistantRows(out)
}
