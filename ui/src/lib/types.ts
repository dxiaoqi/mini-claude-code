export type MessageRole = 'user' | 'assistant' | 'system'

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: unknown
  isError?: boolean
}

export interface ChatMessage {
  id: string
  role: MessageRole
  text: string         // accumulated text content
  toolCalls: ToolCall[]
  isStreaming?: boolean
  usage?: { inputTokens: number; outputTokens: number }
  timestamp: number
}

export interface PermissionRequest {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  message: string
  riskLevel: string
}
