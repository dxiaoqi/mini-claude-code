/**
 * lib/api.ts — mini-claude-code HTTP API 客户端
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export interface SessionInfo {
  id: string
  messageCount: number
  model: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUSD: number
  permissionMode: string
  createdAt: string
  lastActiveAt: string
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentBlock[]
  type?: string
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

// SSE 事件类型
export type SSEEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_start'; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; toolUseId: string; result: unknown; isError?: boolean }
  | { type: 'tool_end'; toolName: string; output: unknown }
  | { type: 'turn_complete'; turnCount: number; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'permission_request'; requestId: string; toolName: string; input: Record<string, unknown>; message: string; riskLevel: string }
  | { type: 'error'; message?: string; error?: { message: string } }
  | { type: 'done'; sessionId: string }
  | { type: 'session_end'; sessionId: string }

export async function createSession(opts?: {
  model?: string
  sessionId?: string
  resumeSessionId?: string
}): Promise<SessionInfo> {
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts || {}),
  })
  const data = await res.json()
  return data.session
}

export async function getSessions(): Promise<{ active: SessionInfo[]; history: { sessionId: string; modifiedAt: string }[] }> {
  const res = await fetch(`${API_BASE}/api/sessions`)
  return res.json()
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/api/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function compactSession(sessionId: string): Promise<{ ok: boolean; preTokens?: number; postTokens?: number }> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/compact`, { method: 'POST' })
  return res.json()
}

export async function respondPermission(
  requestId: string,
  decision: 'allow' | 'allow_always' | 'deny',
): Promise<void> {
  await fetch(`${API_BASE}/api/permission/${requestId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  })
}

export function streamChat(
  sessionId: string,
  message: string,
  opts?: { model?: string; bypassPermissions?: boolean },
): EventSource {
  // EventSource doesn't support POST, so we use fetch with ReadableStream
  // Return an EventSource-like interface via a custom wrapper
  throw new Error('Use streamChatFetch instead')
}

/**
 * POST /api/sessions/:id/chat → SSE stream
 * Returns an async generator of parsed SSE events
 */
export async function* streamChatFetch(
  sessionId: string,
  message: string,
  opts?: { model?: string; bypassPermissions?: boolean },
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...opts }),
    signal,
  })

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    let eventType = ''
    let dataLine = ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        dataLine = line.slice(6).trim()
      } else if (line === '' && dataLine) {
        try {
          const parsed = JSON.parse(dataLine)
          if (eventType === 'done') {
            yield { type: 'done', sessionId: parsed.sessionId } as SSEEvent
          } else if (eventType) {
            yield { ...parsed, type: eventType } as SSEEvent
          }
        } catch { /* skip malformed */ }
        eventType = ''
        dataLine = ''
      }
    }
  }
}
