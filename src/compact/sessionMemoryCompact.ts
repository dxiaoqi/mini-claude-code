/**
 * Session Memory 压缩 — 基于 token 窗口智能切片
 *
 * 按估算 token 的滑动窗口从尾部保留最近消息，将前缀替换为摘要边界，
 * 在压缩体积的同时尽量维持 tool_use / tool_result 配对不变。
 */
import type { Message, ContentBlock, ToolResultBlock } from '../types.js'
import type { CompactionResult } from './types.js'
import { estimateTokens, estimateMessagesTokens } from './tokenEstimator.js'

export interface SessionMemoryCompactConfig {
  minTokens: number
  minTextBlockMessages: number
  maxTokens: number
}

const DEFAULT_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 10_000,
  minTextBlockMessages: 5,
  maxTokens: 40_000,
}

/**
 * Session memory compact: slice history using a sliding window approach.
 * Keeps a computed tail of recent messages, replaces the prefix with
 * a summary boundary. Preserves tool_use/tool_result pairing invariants.
 */
export function trySessionMemoryCompaction(
  messages: Message[],
  config: Partial<SessionMemoryCompactConfig> = {},
  autoCompactThreshold?: number,
): CompactionResult | null {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const totalTokens = estimateMessagesTokens(messages)

  if (totalTokens < cfg.minTokens * 2) {
    return null
  }

  // Calculate the keep index: start from the end, accumulate tokens
  const keepIndex = calculateMessagesToKeepIndex(messages, cfg)

  if (keepIndex <= 0) {
    return null
  }

  // Adjust to preserve API invariants (tool_use/tool_result pairs)
  const adjustedIndex = adjustIndexToPreserveAPIInvariants(messages, keepIndex)

  if (adjustedIndex <= 0 || adjustedIndex >= messages.length - 2) {
    return null
  }

  const discarded = messages.slice(0, adjustedIndex)
  const kept = messages.slice(adjustedIndex)

  const preTokens = estimateMessagesTokens(messages)
  const postTokens = estimateMessagesTokens(kept)

  // If post-compact is still above threshold, this strategy isn't enough
  if (autoCompactThreshold && postTokens >= autoCompactThreshold) {
    return null
  }

  const summaryParts = buildDiscardedSummary(discarded)

  const boundaryMessage: Message = {
    role: 'system',
    content: `[Session memory compact: ${discarded.length} messages summarized]\n\n${summaryParts}`,
    type: 'compact_boundary',
  }

  return {
    messages: [boundaryMessage, ...kept],
    preCompactTokenCount: preTokens,
    postCompactTokenCount: postTokens + estimateTokens(boundaryMessage),
    strategy: 'session_memory',
    freedTokens: preTokens - postTokens,
  }
}

/**
 * Calculate where to start keeping messages from the end.
 */
function calculateMessagesToKeepIndex(
  messages: Message[],
  config: SessionMemoryCompactConfig,
): number {
  let tokensBudget = config.maxTokens
  let textBlockMessagesCount = 0
  let keepIndex = messages.length

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const msgTokens = estimateTokens(msg)

    if (tokensBudget - msgTokens < config.minTokens && i < messages.length - config.minTextBlockMessages) {
      break
    }

    tokensBudget -= msgTokens
    keepIndex = i

    if (hasTextBlocks(msg)) {
      textBlockMessagesCount++
    }

    if (textBlockMessagesCount >= config.minTextBlockMessages && tokensBudget <= config.minTokens) {
      break
    }
  }

  return keepIndex
}

/**
 * Adjust the cut index to avoid breaking tool_use/tool_result pairs.
 * A tool_result must always be preceded by its matching tool_use in the
 * same assistant turn.
 */
function adjustIndexToPreserveAPIInvariants(
  messages: Message[],
  startIndex: number,
): number {
  let idx = startIndex

  // Walk forward to ensure we don't start on a tool_result without its tool_use
  while (idx < messages.length) {
    const msg = messages[idx]

    if (msg.role === 'user' && typeof msg.content !== 'string') {
      const blocks = msg.content as ContentBlock[]
      const hasOrphanToolResult = blocks.some(b => {
        if (b.type !== 'tool_result') return false
        const toolResult = b as ToolResultBlock
        // Check if the matching tool_use is in the kept window
        return !messages.slice(idx - 1, idx).some(m =>
          m.role === 'assistant' &&
          typeof m.content !== 'string' &&
          (m.content as ContentBlock[]).some(
            ab => ab.type === 'tool_use' && 'id' in ab && ab.id === toolResult.tool_use_id,
          ),
        )
      })

      if (hasOrphanToolResult) {
        idx++
        continue
      }
    }

    break
  }

  // Also ensure we don't cut in the middle of an assistant turn
  if (idx > 0 && messages[idx - 1]?.role === 'assistant') {
    // If previous message is assistant with tool_use, we need to include the tool_result too
    const prev = messages[idx - 1]
    if (typeof prev.content !== 'string') {
      const blocks = prev.content as ContentBlock[]
      if (blocks.some(b => b.type === 'tool_use')) {
        idx-- // include the assistant message in the discarded set
      }
    }
  }

  return idx
}

function hasTextBlocks(msg: Message): boolean {
  if (typeof msg.content === 'string') return msg.content.length > 0
  if (Array.isArray(msg.content)) {
    return (msg.content as ContentBlock[]).some(b => b.type === 'text')
  }
  return false
}

function buildDiscardedSummary(messages: Message[]): string {
  const topics: string[] = []

  for (const msg of messages) {
    if (msg.role !== 'user') continue
    const text = typeof msg.content === 'string'
      ? msg.content
      : (msg.content as ContentBlock[])
          .filter(b => b.type === 'text')
          .map(b => (b as { text: string }).text)
          .join(' ')

    if (text.length > 0) {
      topics.push(text.slice(0, 80))
    }
  }

  if (topics.length === 0) return 'Earlier conversation context.'

  return `Topics discussed:\n${topics.map(t => `- ${t}`).join('\n')}`
}
