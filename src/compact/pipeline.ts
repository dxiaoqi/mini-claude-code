/**
 * 压缩管线 — 压缩管线编排器（snip → micro → collapse → auto）
 *
 * 在每次智能体循环回合开头执行完整压缩流程，顺序与 Claude Code 一致：
 * 依次执行 snip 裁剪旧轮次、micro 清理旧工具输出详情、context 折叠上下文，
 * 最后由 auto 在超阈值时选择会话记忆切片或 API 摘要压缩。
 */
import type { APIClient, Message, SessionState } from '../types.js'
import type { CompactPipelineResult } from './types.js'
import { snipCompactIfNeeded } from './snipCompact.js'
import { microCompact } from './microCompact.js'
import { ContextCollapseManager } from './contextCollapse.js'
import { autoCompactIfNeeded } from './autoCompact.js'

/**
 * The full compact pipeline, executed at the start of each agent loop turn.
 *
 * Order (matching original Claude Code):
 *   1. snipCompact    — remove very old turns (no API)
 *   2. microCompact   — clear old tool result details (no API)
 *   3. contextCollapse — fold stale spans into summaries (no API)
 *   4. autoCompact    — session memory or API summary (may call API)
 */
export class CompactPipeline {
  private collapseManager = new ContextCollapseManager()

  async run(
    messages: Message[],
    apiClient: APIClient,
    model: string,
    /** 可选传入 state 以更新 autoCompactTracking 和 lastSummarizedMessageId */
    state?: SessionState,
  ): Promise<CompactPipelineResult> {
    const strategies: string[] = []
    let currentMessages = messages

    // Step 1: Snip compact
    const snipResult = snipCompactIfNeeded(currentMessages)
    if (snipResult.executed) {
      currentMessages = snipResult.messages
      strategies.push(`snip (freed ~${snipResult.tokensFreed} tokens)`)
      // 记录累计 snip 释放量（autoCompact 阈值计算时减去此量）
      if (state) {
        state.autoCompactTracking = {
          snipTokensFreed: (state.autoCompactTracking?.snipTokensFreed || 0) + snipResult.tokensFreed,
          lastCompactTurn: state.autoCompactTracking?.lastCompactTurn || 0,
        }
      }
    }

    // Step 2: Micro compact
    const microResult = microCompact(currentMessages)
    if (microResult !== currentMessages) {
      currentMessages = microResult
      strategies.push('micro')
    }

    // Step 3: Context collapse
    const collapseResult = this.collapseManager.applyCollapsesIfNeeded(currentMessages)
    if (collapseResult.messages !== currentMessages) {
      currentMessages = collapseResult.messages
      strategies.push(`collapse (${this.collapseManager.stagedCount} spans staged)`)
    }

    // Step 4: Auto compact（将 snip 已释放量传入，避免阈值重复触发）
    const snipFreed = state?.autoCompactTracking?.snipTokensFreed || snipResult.tokensFreed
    const autoResult = await autoCompactIfNeeded(
      currentMessages,
      apiClient,
      model,
      snipFreed,
    )
    if (autoResult.wasCompacted && autoResult.compactionResult) {
      currentMessages = autoResult.compactionResult.messages
      strategies.push(`${autoResult.compactionResult.strategy} (freed ~${autoResult.compactionResult.freedTokens} tokens)`)
      // 更新 lastSummarizedMessageId（sessionMemoryCompact 结果的最后一条保留消息 id）
      if (state && autoResult.compactionResult.strategy === 'session_memory') {
        const kept = autoResult.compactionResult.messages
        const lastUserMsg = [...kept].reverse().find(m => m.role === 'user')
        if (lastUserMsg) {
          // 用消息在数组中的位置作为 id（简化实现）
          state.lastSummarizedMessageId = JSON.stringify(lastUserMsg).slice(0, 32)
        }
      }
      if (state) {
        state.autoCompactTracking = {
          snipTokensFreed: 0,  // 重置：compact 后 snip 计数归零
          lastCompactTurn: (state.autoCompactTracking?.lastCompactTurn || 0) + 1,
        }
      }
    }

    return {
      messages: currentMessages,
      wasCompacted: strategies.length > 0,
      strategies,
    }
  }

  /**
   * Drain staged collapses (called on 413 recovery path).
   */
  drainCollapses(messages: Message[]): { messages: Message[]; committed: number; tokensFreed: number } {
    return this.collapseManager.drain(messages)
  }

  /**
   * Reset all compact state (called on /clear).
   */
  reset(): void {
    this.collapseManager.reset()
  }
}
