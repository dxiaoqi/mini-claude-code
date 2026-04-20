/**
 * Coordinator 模式 — Coordinator 多 Agent 协调模式
 *
 * 主入口以协调者为角色：仅暴露 Agent、SendMessage、Task 等编排工具，通过 agentLoop
 * 为子任务生成独立工作者上下文（全量开发工具）；可配置 MCP 服务名、最大轮次等。
 */
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  APIClient,
  AssistantMessage,
  CanUseToolFn,
  ContextProvider,
  Message,
  PermissionResult,
  SessionState,
  StreamEvent,
  Tool,
  Usage,
} from '../../types.js'
import { agentLoop, type AgentLoopResult } from '../agentLoop.js'
import { buildSystemPrompt } from '../../context/systemPrompt.js'
import {
  getCoordinatorSystemPrompt,
  getCoordinatorUserContext,
} from './coordinatorPrompt.js'
import { dateContextProvider } from '../../context/providers/dateContext.js'

export interface CoordinatorConfig {
  apiClient: APIClient
  allTools: Tool[]
  contextProviders: ContextProvider[]
  canUseTool: CanUseToolFn
  mcpServerNames?: string[]
  maxTurns?: number
}

/**
 * Coordinator tools: only the orchestration tools.
 * Workers get the full tool set.
 */
const COORDINATOR_TOOL_NAMES = new Set([
  'Agent', 'SendMessage', 'TaskStop', 'TaskOutput', 'TodoWrite', 'ToolSearch',
])

/**
 * Run in Coordinator mode: the main agent acts as an orchestrator,
 * spawning workers to do the actual work.
 */
export async function* runCoordinatorMode(
  state: SessionState,
  config: CoordinatorConfig,
): AsyncGenerator<StreamEvent, AgentLoopResult> {
  // Create scratchpad directory for cross-worker communication
  const scratchpadDir = await mkdtemp(join(tmpdir(), 'lumi-scratchpad-'))

  // Build coordinator-specific system prompt
  const coordinatorSystemPrompt = getCoordinatorSystemPrompt()
  const workerContext = getCoordinatorUserContext(
    config.allTools,
    scratchpadDir,
    config.mcpServerNames,
  )

  // Coordinator system prompt provider (overrides default)
  const coordinatorPromptProvider: ContextProvider = {
    name: 'coordinator_system',
    placement: 'static',
    cacheBreak: false,
    priority: 0,
    async compute() {
      return coordinatorSystemPrompt
    },
  }

  // Worker capability context provider
  const workerContextProvider: ContextProvider = {
    name: 'worker_capabilities',
    placement: 'dynamic',
    cacheBreak: false,
    priority: 10,
    async compute() {
      return workerContext
    },
  }

  // Filter tools: coordinator only gets orchestration tools
  const coordinatorTools = config.allTools.filter(
    t => COORDINATOR_TOOL_NAMES.has(t.name),
  )

  // Add scratchpad permission bypass for workers
  const coordinatorCanUseTool: CanUseToolFn = async (tool, input, msg) => {
    // Coordinator tools always allowed
    if (COORDINATOR_TOOL_NAMES.has(tool.name)) {
      return { behavior: 'allow' }
    }
    return config.canUseTool(tool, input, msg)
  }

  const contextProviders = [
    coordinatorPromptProvider,
    workerContextProvider,
    dateContextProvider,
    ...config.contextProviders.filter(p => p.name !== 'coordinator_system'),
  ]

  // Run the coordinator agent loop
  const loop = agentLoop({
    state,
    apiClient: config.apiClient,
    tools: coordinatorTools,
    contextProviders,
    canUseTool: coordinatorCanUseTool,
    maxTurns: config.maxTurns ?? 50,
  })

  let result: AgentLoopResult = { reason: 'completed', turnCount: 0 }

  for (;;) {
    const iterResult = await loop.next()
    if (iterResult.done) {
      result = iterResult.value as AgentLoopResult
      break
    }
    yield iterResult.value
  }

  return result
}

/**
 * Build task-notification XML from a completed worker result.
 */
export function buildTaskNotification(
  agentId: string,
  status: 'completed' | 'failed' | 'killed',
  summary: string,
  result: string,
  usage: Usage,
  toolUseCount: number,
  durationMs: number,
): string {
  return `<task-notification>
  <task-id>${agentId}</task-id>
  <status>${status}</status>
  <summary>${escapeXml(summary)}</summary>
  <result>${escapeXml(result)}</result>
  <usage>
    <total_tokens>${usage.inputTokens + usage.outputTokens}</total_tokens>
    <tool_uses>${toolUseCount}</tool_uses>
    <duration_ms>${durationMs}</duration_ms>
  </usage>
</task-notification>`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Detect if the current session should use coordinator mode.
 */
export function isCoordinatorMode(): boolean {
  return process.env.LUMI_COORDINATOR === '1' ||
    process.env.LUMI_COORDINATOR === 'true'
}
