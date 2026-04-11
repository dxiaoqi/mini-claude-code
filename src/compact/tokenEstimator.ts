/**
 * Token 估算器 — CJK/ASCII 混合估算
 *
 * 对单条消息与内容块做粗略 token 计数（兼顾 CJK 与 ASCII 字符特征），
 * 供压缩阈值、窗口切片等决策使用，不用于精确计费。
 */
import type { Message, ContentBlock } from '../types.js'

/**
 * Rough token estimation (~4 chars per token for English, ~2 for CJK).
 * Used for compact threshold decisions — not billing.
 */
export function estimateTokens(message: Message): number {
  if (typeof message.content === 'string') {
    return estimateStringTokens(message.content)
  }

  if (Array.isArray(message.content)) {
    return (message.content as ContentBlock[]).reduce((sum, block) => {
      if (block.type === 'text') return sum + estimateStringTokens(block.text)
      if (block.type === 'tool_use') return sum + estimateStringTokens(JSON.stringify(block.input)) + 20
      if (block.type === 'tool_result') {
        const content = typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content)
        return sum + estimateStringTokens(content)
      }
      return sum + 100 // images etc
    }, 0)
  }

  return 0
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m) + 4, 0) // +4 for role overhead
}

function estimateStringTokens(str: string): number {
  if (!str) return 0
  // Rough heuristic: CJK chars ~1.5 tokens, ASCII ~0.25 tokens per char
  let tokens = 0
  for (const char of str) {
    const code = char.charCodeAt(0)
    if (code > 0x2E80) {
      tokens += 1.5
    } else {
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}
