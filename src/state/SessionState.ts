/**
 * state/SessionState.ts — 会话状态管理
 *
 * 创建会话、清空消息与累加 usage（token 与成本等）。
 */
import { v4 as uuidv4 } from 'uuid'
import { estimateCost } from '../utils/cost.js'
import type {
  AgentHandle,
  Message,
  PermissionMode,
  PermissionRule,
  PromptCacheLatches,
  SessionState,
  Settings,
  Usage,
} from '../types.js'

export function createSessionState(options: {
  cwd: string
  projectRoot?: string
  settings?: Settings
}): SessionState {
  return {
    sessionId: uuidv4(),
    cwd: options.cwd,
    projectRoot: options.projectRoot || options.cwd,

    messages: [],

    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUSD: 0,
    modelUsage: new Map(),

    permissionMode: options.settings?.permissionMode || 'default',
    permissionRules: options.settings?.permissionRules || [],
    denialCounts: new Map(),

    activeAgents: new Map(),

    promptCacheLatches: {
      autoModeHeaderLatched: null,
      fastModeHeaderLatched: null,
      thinkingClearLatched: null,
    },
    systemPromptSectionCache: new Map(),

    model: options.settings?.model || 'gpt-4o',
    fallbackModel: options.settings?.fallbackModel,
    settings: options.settings || {},
  }
}

export function accumulateUsage(state: SessionState, usage: Usage, model: string): void {
  state.totalInputTokens += usage.inputTokens
  state.totalOutputTokens += usage.outputTokens

  const existing = state.modelUsage.get(model) || { input: 0, output: 0, cacheRead: 0 }
  existing.input += usage.inputTokens
  existing.output += usage.outputTokens
  existing.cacheRead += usage.cacheReadTokens || 0
  state.modelUsage.set(model, existing)

  // 累加成本（基于当前批次的 usage）
  state.totalCostUSD += estimateCost(
    model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens || 0,
  )
}

export function addMessage(state: SessionState, message: Message): void {
  state.messages.push(message)
}

export function clearSession(state: SessionState): void {
  state.sessionId = uuidv4()
  state.messages = []
  state.totalInputTokens = 0
  state.totalOutputTokens = 0
  state.totalCostUSD = 0
  state.modelUsage.clear()
  state.denialCounts.clear()
  state.activeAgents.clear()
  state.systemPromptSectionCache.clear()
  state.promptCacheLatches = {
    autoModeHeaderLatched: null,
    fastModeHeaderLatched: null,
    thinkingClearLatched: null,
  }
}
