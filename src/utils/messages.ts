/**
 * utils/messages.ts — 消息工具
 *
 * 构造用户/助手消息，规范化 API 消息并修复 tool_use 与 tool_result 配对。
 */
import type {
  AssistantMessage,
  ContentBlock,
  Message,
  ToolResultBlock,
  ToolUseBlock,
  UserMessage,
} from '../types.js'

export function createUserMessage(content: string | ContentBlock[]): UserMessage {
  return { role: 'user', content }
}

export function createAssistantMessage(content: string | ContentBlock[]): AssistantMessage {
  return { role: 'assistant', content }
}

export function createToolResultMessage(results: ToolResultBlock[]): UserMessage {
  return { role: 'user', content: results }
}

/**
 * Normalize messages for API submission: ensure tool_use/tool_result pairing,
 * strip system messages (they go in system prompt), etc.
 */
export function normalizeMessagesForAPI(messages: Message[]): Message[] {
  const result: Message[] = []

  for (const msg of messages) {
    // Skip system messages (including compact boundaries)
    if (msg.role === 'system') continue
    result.push(msg)
  }

  // Ensure alternating user/assistant pattern for some APIs
  return ensureToolResultPairing(result)
}

/**
 * Ensure every tool_use has a matching tool_result, and vice versa.
 * Orphan tool_use blocks get a synthetic "cancelled" result.
 */
function ensureToolResultPairing(messages: Message[]): Message[] {
  const toolUseIds = new Set<string>()
  const toolResultIds = new Set<string>()

  for (const msg of messages) {
    if (typeof msg.content === 'string') continue
    for (const block of msg.content as ContentBlock[]) {
      if (block.type === 'tool_use') {
        toolUseIds.add((block as ToolUseBlock).id)
      }
      if (block.type === 'tool_result') {
        toolResultIds.add((block as ToolResultBlock).tool_use_id)
      }
    }
  }

  // Find orphan tool_use IDs (no matching result)
  const orphanIds = [...toolUseIds].filter(id => !toolResultIds.has(id))

  if (orphanIds.length === 0) return messages

  // Append synthetic results for orphans
  const syntheticResults: ToolResultBlock[] = orphanIds.map(id => ({
    type: 'tool_result',
    tool_use_id: id,
    content: '[Tool execution was cancelled]',
    is_error: true,
  }))

  return [...messages, createToolResultMessage(syntheticResults)]
}

/**
 * Extract text content from a message (for display or summarization).
 */
export function extractTextContent(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content

  return (msg.content as ContentBlock[])
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('\n')
}

/**
 * Count tool_use blocks in a message array.
 */
export function countToolUses(messages: Message[]): number {
  let count = 0
  for (const msg of messages) {
    if (typeof msg.content === 'string') continue
    for (const block of msg.content as ContentBlock[]) {
      if (block.type === 'tool_use') count++
    }
  }
  return count
}
