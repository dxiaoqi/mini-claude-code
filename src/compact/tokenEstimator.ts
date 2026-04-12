/**
 * Token 估算器 — CJK/ASCII 混合估算
 *
 * 对单条消息与内容块做粗略 token 计数（兼顾 CJK 与 ASCII 字符特征），
 * 供压缩阈值、窗口切片等决策使用，不用于精确计费。
 *
 * tokenCountWithEstimation（参考 Claude Code tokens.ts）：
 *   优先使用最后一次 API 返回的实际 inputTokens（精确），
 *   加上此后新增消息的字符估算（粗估），避免重复计费。
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

/**
 * 组合式 token 计数：
 *   lastKnownTokens = 最后一次 API 响应中的实际 inputTokens
 *   newMessages     = 该 API 调用之后新增的消息（尚未参与过 API 调用）
 *
 * 若 lastKnownTokens 未知（0），退化为纯估算 × 1.5 校正系数。
 */
export function tokenCountWithEstimation(
  messages: Message[],
  lastKnownTokens: number,
  newMessagesCount: number = 0,
): number {
  if (lastKnownTokens > 0) {
    // 新消息数量：一般是本轮用户输入（1-2条）
    const tail = newMessagesCount > 0
      ? messages.slice(-newMessagesCount)
      : []
    const tailEstimate = tail.reduce((sum, m) => sum + estimateTokens(m) + 4, 0)
    return lastKnownTokens + tailEstimate
  }
  // 退化到纯字符估算，乘以 1.5 校正系数（补偿代码内容低估）
  return Math.ceil(estimateMessagesTokens(messages) * 1.5)
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
