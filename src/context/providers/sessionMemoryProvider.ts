/**
 * sessionMemoryProvider — 跨会话记忆注入
 *
 * 在新会话的第一轮，检查是否有来自同一项目上一次会话的 session memory，
 * 若有则注入为 dynamic context，让 agent 能直接了解上次进度，
 * 避免重复探索已完成的工作。
 *
 * 触发条件：
 *   - 同一 projectRoot 下有历史会话的 memory.json
 *   - 当前 sessionId 与历史 sessionId 不同
 *
 * Placement: dynamic（每轮都检查，但实际内容只在有历史时注入）
 * CacheBreak: false（会话内只计算一次，避免反复读文件）
 */

import type { ContextProvider, SessionState } from '../../types.js'
import { getSessionMemoryContext } from '../../compact/sessionMemory.js'

export const sessionMemoryProvider: ContextProvider = {
  name: 'session_memory',
  placement: 'dynamic',
  cacheBreak: false, // 会话内缓存，/clear 后重新计算

  async compute(session: SessionState): Promise<string | null> {
    try {
      const context = await getSessionMemoryContext(session.projectRoot, session.sessionId)
      if (!context) return null

      return [
        '---',
        '**Previous Session Memory** (auto-loaded from last session in this project):',
        '',
        context,
        '',
        '_Note: This is context from a previous session. Verify current file states before making assumptions._',
        '---',
      ].join('\n')
    } catch {
      return null
    }
  },
}
