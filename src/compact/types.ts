/**
 * 压缩类型 — 压缩管线共享类型定义
 *
 * 导出单次压缩结果（CompactionResult）与管线汇总（CompactPipelineResult）等结构，
 * 供 snip、micro、折叠、session memory、API/reactive 与各编排模块共用。
 */
import type { Message } from '../types.js'

export interface CompactionResult {
  messages: Message[]
  preCompactTokenCount?: number
  postCompactTokenCount?: number
  strategy: 'snip' | 'micro' | 'collapse_drain' | 'session_memory' | 'api_compact' | 'reactive'
  freedTokens?: number
}

export interface CompactPipelineResult {
  messages: Message[]
  wasCompacted: boolean
  strategies: string[]
}
