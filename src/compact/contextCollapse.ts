/**
 * 上下文折叠 — staged 折叠 + 413 时 drain 恢复
 *
 * 将连续对话区间折叠为摘要：staged 在预处理中形成「视图」，committed 永久替换原文；
 * 遇 413 prompt_too_long 时可 drain 已暂存折叠以释放真实 token，再交由被动压缩链路。
 */
import type { Message } from '../types.js'
import { estimateTokens, estimateMessagesTokens } from './tokenEstimator.js'

interface CollapseSpan {
  startIndex: number
  endIndex: number
  summary: string
  originalTokens: number
  status: 'staged' | 'committed'
}

/**
 * Context collapse: fold contiguous conversation spans into summaries.
 * Staged collapses are applied in preprocessing; committed collapses
 * replace the original messages permanently.
 *
 * On 413 (prompt_too_long), staged collapses are drained (committed)
 * to free real tokens before falling through to reactive compact.
 */
export class ContextCollapseManager {
  private stagedCollapses: CollapseSpan[] = []

  /**
   * Apply staged collapses to messages for the current turn.
   * This is a "view" — original messages remain accessible for drain.
   */
  applyCollapsesIfNeeded(messages: Message[]): { messages: Message[] } {
    if (this.stagedCollapses.length === 0) {
      // Auto-detect spans eligible for collapse
      this.detectCollapseSpans(messages)
    }

    if (this.stagedCollapses.length === 0) {
      return { messages }
    }

    return { messages: this.applyCollapses(messages) }
  }

  /**
   * Drain: commit all staged collapses permanently (used on 413 recovery).
   * Returns the compacted messages and number of tokens freed.
   */
  drain(messages: Message[]): { messages: Message[]; committed: number; tokensFreed: number } {
    if (this.stagedCollapses.length === 0) {
      return { messages, committed: 0, tokensFreed: 0 }
    }

    const result = this.applyCollapses(messages)
    const tokensFreed = this.stagedCollapses.reduce((sum, c) => sum + c.originalTokens, 0)
    const committed = this.stagedCollapses.length

    // Mark all as committed and clear
    this.stagedCollapses = []

    return { messages: result, committed, tokensFreed }
  }

  /**
   * Clear all staged collapses (on /clear or /compact).
   */
  reset(): void {
    this.stagedCollapses = []
  }

  get stagedCount(): number {
    return this.stagedCollapses.length
  }

  /**
   * Detect conversation spans that can be collapsed.
   * Heuristic: consecutive user+assistant pairs that are >N turns old
   * and whose tool results have already been micro-compacted.
   */
  private detectCollapseSpans(messages: Message[]): void {
    const totalTokens = estimateMessagesTokens(messages)

    // Only collapse when context is getting large (>60K tokens)
    if (totalTokens < 60_000) return

    // Find "stale" conversation spans — groups of user+assistant pairs
    // from the early part of the conversation
    let i = 0
    const threshold = Math.floor(messages.length * 0.4) // collapse first 40%

    while (i < threshold && i < messages.length - 6) {
      const spanStart = i
      let spanEnd = i

      // Extend span through consecutive user-assistant pairs
      while (spanEnd < threshold && spanEnd + 1 < messages.length) {
        if (messages[spanEnd].role === 'user' && messages[spanEnd + 1]?.role === 'assistant') {
          spanEnd += 2
        } else if (messages[spanEnd].role === 'system') {
          spanEnd++
        } else {
          break
        }
      }

      if (spanEnd > spanStart + 1) {
        const spanMessages = messages.slice(spanStart, spanEnd)
        const spanTokens = estimateMessagesTokens(spanMessages)

        // Only collapse spans worth >2K tokens
        if (spanTokens > 2000) {
          const summary = this.summarizeSpan(spanMessages)
          this.stagedCollapses.push({
            startIndex: spanStart,
            endIndex: spanEnd,
            summary,
            originalTokens: spanTokens,
            status: 'staged',
          })
        }
      }

      i = spanEnd
    }
  }

  private summarizeSpan(messages: Message[]): string {
    const parts: string[] = []

    for (const msg of messages) {
      if (msg.role === 'user') {
        const text = typeof msg.content === 'string'
          ? msg.content.slice(0, 100)
          : '[complex content]'
        parts.push(`User: ${text}`)
      } else if (msg.role === 'assistant') {
        const text = typeof msg.content === 'string'
          ? msg.content.slice(0, 100)
          : '[tool use + response]'
        parts.push(`Assistant: ${text}`)
      }
    }

    return `[Collapsed ${messages.length} messages]\n${parts.join('\n')}`
  }

  private applyCollapses(messages: Message[]): Message[] {
    if (this.stagedCollapses.length === 0) return messages

    // Sort collapses by startIndex descending to apply from end
    const sorted = [...this.stagedCollapses].sort((a, b) => b.startIndex - a.startIndex)

    const result = [...messages]

    for (const collapse of sorted) {
      const boundaryMessage: Message = {
        role: 'system',
        content: collapse.summary,
        type: 'compact_boundary',
      }

      result.splice(
        collapse.startIndex,
        collapse.endIndex - collapse.startIndex,
        boundaryMessage,
      )
    }

    return result
  }
}
