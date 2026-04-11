/**
 * 历史裁剪压缩 — 归档旧对话，可恢复
 *
 * 将超过保留策略的旧对话轮次整体移入内存归档（snipArchive），从发往 API 的
 * 活跃消息列表中移除，但保留用于导出、调试或恢复；可统计估算释放的 token。
 */
import type { Message, ContentBlock, ToolResultBlock } from '../types.js'
import type { CompactionResult } from './types.js'
import { estimateTokens } from './tokenEstimator.js'

interface SnipConfig {
  maxAgeTurns: number
  minMessagesToKeep: number
}

const DEFAULT_CONFIG: SnipConfig = {
  maxAgeTurns: 20,
  minMessagesToKeep: 6,
}

/**
 * Archive of snipped messages. Can be used to restore context
 * (e.g. for /resume, session export, or debugging).
 * Keyed by snip timestamp.
 */
const snipArchive: Array<{
  timestamp: string
  messages: Message[]
  tokensFreed: number
}> = []

/**
 * Snip compact: move entire old conversation turns to an archive.
 * The messages are NOT destroyed — they're preserved in snipArchive
 * and can be exported or restored. Only removed from the active
 * messages array sent to the API.
 *
 * Strategy: Count assistant-turn boundaries from the end. Turns older
 * than maxAgeTurns are archived and replaced with a summary boundary.
 */
export function snipCompactIfNeeded(
  messages: Message[],
  config: Partial<SnipConfig> = {},
): { messages: Message[]; executed: boolean; tokensFreed: number } {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  if (messages.length <= cfg.minMessagesToKeep) {
    return { messages, executed: false, tokensFreed: 0 }
  }

  let turnCount = 0
  let cutoffIndex = -1

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      turnCount++
    }
    if (turnCount >= cfg.maxAgeTurns) {
      cutoffIndex = i
      break
    }
  }

  if (cutoffIndex <= 0) {
    return { messages, executed: false, tokensFreed: 0 }
  }

  const keptCount = messages.length - cutoffIndex
  if (keptCount < cfg.minMessagesToKeep) {
    return { messages, executed: false, tokensFreed: 0 }
  }

  const snipped = messages.slice(0, cutoffIndex)
  const kept = messages.slice(cutoffIndex)

  const freedTokens = snipped.reduce((sum, m) => sum + estimateTokens(m), 0)

  // Archive instead of destroy
  snipArchive.push({
    timestamp: new Date().toISOString(),
    messages: snipped,
    tokensFreed: freedTokens,
  })

  // Build a richer boundary that summarizes what was archived
  const summary = buildSnipSummary(snipped)

  const boundaryMessage: Message = {
    role: 'system',
    content: `[${snipped.length} earlier messages archived. ${freedTokens} est. tokens freed.]\n\n${summary}`,
    type: 'compact_boundary',
  }

  return {
    messages: [boundaryMessage, ...kept],
    executed: true,
    tokensFreed: freedTokens,
  }
}

/**
 * Get all archived snip entries. Useful for /resume, export, debugging.
 */
export function getSnipArchive(): ReadonlyArray<{
  timestamp: string
  messages: readonly Message[]
  tokensFreed: number
}> {
  return snipArchive
}

/**
 * Restore the most recent snipped messages back into the active context.
 * Returns null if no archive entries exist.
 */
export function restoreLastSnip(): Message[] | null {
  const entry = snipArchive.pop()
  return entry ? entry.messages : null
}

/**
 * Get total archived message count across all snip entries.
 */
export function getArchivedMessageCount(): number {
  return snipArchive.reduce((sum, e) => sum + e.messages.length, 0)
}

/**
 * Clear the archive (on session clear).
 */
export function clearSnipArchive(): void {
  snipArchive.length = 0
}

function buildSnipSummary(messages: Message[]): string {
  const topics: string[] = []
  const toolsUsed = new Set<string>()
  const filesReferenced = new Set<string>()

  for (const msg of messages) {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      topics.push(msg.content.slice(0, 60))
    }

    if (msg.role === 'assistant' && typeof msg.content !== 'string') {
      for (const block of msg.content as ContentBlock[]) {
        if (block.type === 'tool_use') {
          const toolUse = block as { name: string; input: Record<string, unknown> }
          toolsUsed.add(toolUse.name)
          const filePath = toolUse.input?.file_path || toolUse.input?.path || toolUse.input?.notebook_path
          if (typeof filePath === 'string') filesReferenced.add(filePath)
        }
      }
    }
  }

  const parts: string[] = []
  if (topics.length > 0) {
    parts.push(`Topics: ${topics.slice(0, 5).join(' | ')}${topics.length > 5 ? ` (+${topics.length - 5} more)` : ''}`)
  }
  if (toolsUsed.size > 0) {
    parts.push(`Tools used: ${[...toolsUsed].join(', ')}`)
  }
  if (filesReferenced.size > 0) {
    parts.push(`Files referenced: ${[...filesReferenced].slice(0, 10).join(', ')}`)
  }

  return parts.join('\n') || 'Earlier conversation context.'
}
