/**
 * 压缩管线 — 简化为两层（参考 Claude Code 实际生效路径）
 *
 * 执行顺序：
 *   Phase 1: microCompact  — 清除旧工具输出详情（无 API 调用，快速）
 *   Phase 2: summaryCompact — LLM 生成摘要替换旧消息（有 API 调用，仅在超阈值时触发）
 *
 * 之前的 snipCompact / contextCollapse / autoCompact 已废弃：
 *   - snipCompact：在 assistant 消息处切割导致消息序列非法（Doubao 等厂商 1214 错误）
 *   - contextCollapse：Claude Code 中也是死代码（feature flag 永远 false）
 *   - autoCompact：被 summaryCompact 取代（更准确的阈值 + 更好的信息保留）
 *
 * Session Memory：
 *   每次 summaryCompact 触发后，自动将摘要+元数据持久化到
 *   用户主目录下 Blino memory/<hash>/memory.json（见 blinoPaths），供后续会话参考。
 */

import type { APIClient, Message, SessionState } from '../types.js'
import type { CompactPipelineResult } from './types.js'
import { microCompact } from './microCompact.js'
import { summaryCompactIfNeeded, getAutoCompactThreshold, getWarningThreshold } from './summaryCompact.js'
import { tokenCountWithEstimation } from './tokenEstimator.js'
import { saveSessionMemory, extractMetadataFromMessages } from './sessionMemory.js'

export class CompactPipeline {
  /**
   * 在每轮 agentLoop 开始时执行压缩管线。
   *
   * @param messages     当前 state.messages
   * @param apiClient    API 客户端（summaryCompact 需要调用 LLM）
   * @param model        当前模型名（用于计算阈值）
   * @param state        SessionState（用于读取 lastTurnInputTokens 和写 sessionMemory）
   */
  async run(
    messages: Message[],
    apiClient: APIClient,
    model: string,
    state?: SessionState,
  ): Promise<CompactPipelineResult> {
    const strategies: string[] = []
    let currentMessages = messages

    // ── Phase 1: microCompact（无 API 调用）──────────────────────────────────────
    // 清除非最近 5 轮的大型工具输出详情，减少发给 LLM 的 token 量
    const microResult = microCompact(currentMessages)
    if (microResult !== currentMessages) {
      currentMessages = microResult
      strategies.push('micro')
    }

    // ── Phase 2: summaryCompact（有 API 调用，仅超阈值时触发）────────────────────
    // 使用实际 token 数（来自上轮 API 响应）+ 新消息粗估，比字符估算更准确
    const lastKnownTokens = state?.lastTurnInputTokens ?? 0
    // 本轮新增消息：通常是用户输入（1-2 条），尚未经过 API 调用
    const newMessagesCount = lastKnownTokens > 0
      ? Math.max(0, currentMessages.length - Math.floor(lastKnownTokens / 50))
      : 0
    const currentTokens = tokenCountWithEstimation(currentMessages, lastKnownTokens, newMessagesCount)

    const threshold = getAutoCompactThreshold(model)
    const warningThreshold = getWarningThreshold(model)

    const isArtifactsMode = !!state?.settings?.systemPromptAddendum

    const artifactsCustomInstructions = isArtifactsMode
      ? 'IMPORTANT: This session runs in UI/Artifacts mode. The agent outputs content inline (SVG, HTML, markdown) — it does NOT write files to disk. Do NOT record any file paths under /tmp/ or elsewhere as "completed work". If the conversation mentions FileWrite calls or Skill tool calls that failed, treat them as errors to be noted under "Errors & Fixes", not as valid completed items or pending tasks to retry.'
      : undefined

    const artifactsSummaryPrefix = isArtifactsMode
      ? `⚠️ ARTIFACTS MODE ACTIVE — Rules that apply for the rest of this session:
- Output ALL content inline using <text> and <visual type="svg|html|threejs"> tags only
- NEVER call Skill("streaming-artifacts") or any Skill tool — these are not available
- NEVER use FileWrite, FileEdit, Bash, or any write tool
- NEVER read project source files (*.ts, *.js, etc.) — this is a UI session, not a code session
- Any failed Skill calls in the summary above are past errors — do NOT retry them`
      : undefined

    const compactResult = await summaryCompactIfNeeded(
      currentMessages,
      apiClient,
      model,
      currentTokens,
      4,
      artifactsCustomInstructions,
      artifactsSummaryPrefix,
    )

    if (compactResult.result) {
      const tokensBefore = currentTokens
      currentMessages = compactResult.messages
      const freed = compactResult.result.tokensFreed
      const tokensAfter = Math.max(0, tokensBefore - freed)
      strategies.push(`summary (freed ~${freed} tokens)`)

      // Session Memory：压缩后持久化摘要+元数据
      if (state) {
        const metadata = extractMetadataFromMessages(
          messages, // 压缩前的原始消息，用于提取文件列表等
          model,
          state.totalInputTokens > 0 ? Math.round(state.totalInputTokens / Math.max(1, currentMessages.length / 2)) : 0,
          state.totalInputTokens,
          state.totalOutputTokens,
        )

        // 异步写入，不阻塞 agent 继续工作；失败时记录 warn 而非静默丢弃
        saveSessionMemory(
          state.projectRoot,
          state.sessionId,
          compactResult.result.summaryText,
          metadata,
        ).catch((err: unknown) => {
          const logger = state.settings?.logger as
            | { warn?: (o: object, s: string) => void }
            | undefined
          const msg = err instanceof Error ? err.message : String(err)
          if (logger?.warn) {
            logger.warn({ sessionId: state.sessionId, err: msg }, '[sessionMemory] failed to save after retries')
          } else {
            // eslint-disable-next-line no-console
            console.warn(`[sessionMemory] failed to save after retries: ${msg}`)
          }
        })
      }

      return {
        messages: currentMessages,
        wasCompacted: true,
        strategies,
        tokensBefore,
        tokensAfter,
        tokensFreed: freed,
      }
    } else if (compactResult.warning) {
      strategies.push(`warning (${currentTokens}/${threshold} tokens)`)
    }

    return {
      messages: currentMessages,
      wasCompacted: false,
      strategies,
      tokensBefore: 0,
      tokensAfter: 0,
      tokensFreed: 0,
    }
  }

  /**
   * 获取当前上下文的 token 状态（供 UI 显示）。
   */
  getTokenStatus(messages: Message[], model: string, lastKnownTokens: number): {
    tokens: number
    threshold: number
    warningThreshold: number
    status: 'ok' | 'warning' | 'critical'
  } {
    const tokens = tokenCountWithEstimation(messages, lastKnownTokens)
    const threshold = getAutoCompactThreshold(model)
    const warningThreshold = getWarningThreshold(model)

    return {
      tokens,
      threshold,
      warningThreshold,
      status: tokens >= threshold ? 'critical'
        : tokens >= warningThreshold ? 'warning'
        : 'ok',
    }
  }

  /**
   * Reset（/clear 时调用）。
   * 新 pipeline 无状态，重置为空操作。
   */
  reset(): void {
    // summaryCompact 无内部状态，无需重置
  }

  /**
   * Drain（413 兜底路径，保持接口兼容）。
   * 新 pipeline 不使用 drain，原样返回。
   */
  drainCollapses(messages: Message[]): { messages: Message[]; committed: number; tokensFreed: number } {
    return { messages, committed: 0, tokensFreed: 0 }
  }
}
