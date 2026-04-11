/**
 * 自动压缩触发器 — 阈值判断 + 策略选择
 *
 * 根据估算 token 与配置阈值判断是否提示或执行压缩：优先尝试 Session Memory
 * 切片（无额外紧凑专用 API 调用），不满足时再回退到 apiCompact。
 */
import type { APIClient, Message } from '../types.js'
import type { CompactionResult } from './types.js'
import { estimateMessagesTokens } from './tokenEstimator.js'
import { trySessionMemoryCompaction } from './sessionMemoryCompact.js'
import { apiCompact } from './apiCompact.js'

interface AutoCompactConfig {
  tokenThreshold: number
  warningThreshold: number
}

const DEFAULT_CONFIG: AutoCompactConfig = {
  tokenThreshold: 100_000,
  warningThreshold: 80_000,
}

export interface AutoCompactResult {
  wasCompacted: boolean
  compactionResult?: CompactionResult
  tokenWarning?: 'approaching' | 'exceeded'
}

/**
 * Auto compact trigger: evaluates whether the context needs compaction
 * and selects the best strategy.
 *
 * Priority:
 *   1. Session memory compact (fast, no API call for the compact itself)
 *   2. API compact (calls LLM to generate summary)
 */
export async function autoCompactIfNeeded(
  messages: Message[],
  apiClient: APIClient,
  model: string,
  snipTokensFreed: number = 0,
  config: Partial<AutoCompactConfig> = {},
): Promise<AutoCompactResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  const totalTokens = estimateMessagesTokens(messages) - snipTokensFreed

  if (totalTokens < cfg.warningThreshold) {
    return { wasCompacted: false }
  }

  if (totalTokens < cfg.tokenThreshold) {
    return { wasCompacted: false, tokenWarning: 'approaching' }
  }

  // Token threshold exceeded — try compaction strategies

  // Strategy 1: Session memory compact
  const smResult = trySessionMemoryCompaction(messages, undefined, cfg.tokenThreshold)
  if (smResult) {
    return {
      wasCompacted: true,
      compactionResult: smResult,
      tokenWarning: 'exceeded',
    }
  }

  // Strategy 2: API compact
  const apiResult = await apiCompact({ messages, apiClient, model })
  if (apiResult) {
    return {
      wasCompacted: true,
      compactionResult: apiResult,
      tokenWarning: 'exceeded',
    }
  }

  return { wasCompacted: false, tokenWarning: 'exceeded' }
}
