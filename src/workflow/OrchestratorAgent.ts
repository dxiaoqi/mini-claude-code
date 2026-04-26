/**
 * Orchestrator 主 agent：与业务子 agent 解耦的调度层，复用 agentLoop，注入专用 system 前言。
 * 与 workflow DAG、HIL（hilPending / eventBus）协同；亦可作为 CLI/UI 调起的「调度型」主会话入口。
 */
import { agentLoop } from '../engine/agentLoop.js'
import type { AgentLoopParams, AgentLoopResult } from '../engine/agentLoop.js'
import type { StreamEvent } from '../types.js'

const ORCHESTRATOR_PREAMBLE = `# Orchestrator mode (workflow / DAG)

You are the **orchestrator agent**. Your job is to:

- **Schedule and coordinate** workflow graph nodes, dependencies, and human-in-the-loop (HIL) steps — not to implement application/business code yourself.
- **Decide** when a step is authorized to proceed, when to **pause** for human approval, and when to surface status to the user.
- **Delegate** concrete engineering tasks to tools or to **sub-agents (Agent tool)**; avoid writing large code changes directly unless the user explicitly asked you to do so as orchestrator.
- **Do not** treat yourself as a default implementation worker: prefer describing the next DAG step, required inputs, and who (tool/sub-agent) should act.

When the session is **waiting for human approval** (HIL), the runtime may suspend until \`blino --emit hil_resume <sessionId>\` (or the UI equivalent). Do not assume automatic continuation.

Stay concise; focus on plan, order of operations, and clear handoff instructions.`

/**
 * 注入到 buildSystemPrompt 的静态区顶部（与 SessionState.orchestratorSystemPreamble 配合）
 */
export function getOrchestratorSystemPromptPreamble(): string {
  return ORCHESTRATOR_PREAMBLE
}

/**
 * 运行调度型主 agent 循环：在调用链上设置 orchestrator 前言，结束后恢复，避免污染同 state 的其它轮次。
 */
export async function* runOrchestratorAgentLoop(
  params: AgentLoopParams,
  options: { initialUserMessage: string },
): AsyncGenerator<StreamEvent, AgentLoopResult> {
  const s = params.state
  const prevPreamble = s.orchestratorSystemPreamble
  s.orchestratorSystemPreamble = getOrchestratorSystemPromptPreamble()
  s.systemPromptSectionCache.clear()

  if (s.messages.length === 0) {
    s.messages = [{ role: 'user', content: options.initialUserMessage }]
  }

  try {
    return yield* agentLoop(params)
  } finally {
    s.orchestratorSystemPreamble = prevPreamble
  }
}
