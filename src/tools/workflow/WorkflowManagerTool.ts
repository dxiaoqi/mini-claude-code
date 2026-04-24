/**
 * 仅在 workflowManager.mode === auto 时为主 Agent 加载。
 * 派生轻量子 Agent，仅持 WorkflowPhase + AskUser +（可选）Skill，不干扰主对话上下文。
 */
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import type { APIClient, ContentBlock, Message, PermissionResult, SessionState, Tool, ToolResult, Usage, AssistantMessage, CanUseToolFn } from '../../types.js'
import { createSessionState, accumulateUsage } from '../../state/SessionState.js'
import { agentLoop } from '../../engine/agentLoop.js'
import { buildSystemPrompt } from '../../context/systemPrompt.js'
import { dateContextProvider } from '../../context/providers/dateContext.js'
import { AskUserTool } from '../interaction/AskUserTool.js'
import { SkillTool } from '../interaction/SkillTool.js'
import { createToolSearchTool } from '../ToolSearchTool.js'
import { WorkflowPhaseTool } from './WorkflowPhaseTool.js'
import { setWorkflowSubAgentState } from './workflowSubAgentState.js'
import { loadWorkflowPolicy, mergeSettingsWithPolicy } from '../../utils/workflow.js'
import { applyWorkflowRuntimeToState } from '../../utils/workflowRuntime.js'
const inputSchema = z.object({
  task: z
    .string()
    .min(1)
    .describe('What to do: e.g. "Decide if we should advance phase after the user message" with quoted evidence'),
})

type Input = z.infer<typeof inputSchema>

type Output = { ok: boolean; result: string; turnCount: number; usage: Usage }

function findWorkflowManagerModel(state: SessionState): string {
  return state.settings.workflowManager?.model?.trim() || state.model
}

function buildManagerTask(task: string, state: SessionState): string {
  const pol = state.settings.projectPolicy
  const phases = pol?.phases?.map(p => {
    const packs = p.activateSkillPacks?.length ? ` packs=${p.activateSkillPacks.join(',')}` : ''
    return `- ${p.id}${p.notes ? `: ${p.notes}` : ''}${packs}`
  }).join('\n') || '(no phases — do nothing)'

  const cur = state.activePhaseId
    ? `${state.activePhaseId} (index ${state.activePhaseIndex ?? 0})`
    : 'unset'

  return `You are the WorkflowManager sub-agent. Project profile: ${pol?.profile || 'default'}.
Current active phase: ${cur}

Phases in workflow.json:
${phases}

User/system task:
${task}

Rules:
- You do NOT write code, edit files, or run shell. Use only WorkflowPhase, AskUser, Skill (optional), ToolSearch to load them.
- Call WorkflowPhase only when the task clearly justifies a phase id change. Use AskUser for human-in-the-loop when unsure.
- End with a short summary of what you did.`
}

const allowAll: CanUseToolFn = async () => ({ behavior: 'allow' as const })

export function createWorkflowManagerTool(apiClient: APIClient): Tool<Input, Output> {
  return {
    name: 'WorkflowManager',
    description: `Run the dedicated lightweight workflow sub-agent (only when workflow is in "auto" mode). Use for phase alignment, HIL, and pack-aware skills without bloating the main chat. Pass a short task string describing what to check or decide.`,

    inputSchema,
    shouldDefer: true,
    alwaysLoad: false,

    shouldIncludeInApi(ctx) {
      return ctx.state.settings.workflowManager?.mode === 'auto'
    },

    isReadOnly() { return true },
    isConcurrencySafe() { return false },

    async checkPermissions(): Promise<PermissionResult> {
      return { behavior: 'allow' }
    },

    async call(input, context, canUseTool, _parent, onProgress): Promise<ToolResult<Output>> {
      if (context.sessionState.settings.workflowManager?.mode !== 'auto') {
        return { data: { ok: false, result: 'WorkflowManager is only available in workflowManager.mode=auto', turnCount: 0, usage: { inputTokens: 0, outputTokens: 0 } } }
      }

      const parent = context.sessionState
      const { policy } = await loadWorkflowPolicy(parent.projectRoot)
      if (policy) {
        parent.settings = mergeSettingsWithPolicy(parent.settings, policy) as typeof parent.settings
        applyWorkflowRuntimeToState(parent)
      }

      const agentId = uuidv4().slice(0, 8)
      const subModel = findWorkflowManagerModel(parent)

      const sub: SessionState = {
        ...createSessionState({ cwd: parent.cwd, settings: { ...parent.settings, blinoSubAgent: 'workflow-manager' } }),
        projectRoot: parent.projectRoot,
        sessionId: `${parent.sessionId}-wfmg-${agentId}`,
        model: subModel,
        activePhaseIndex: parent.activePhaseIndex,
        activePhaseId: parent.activePhaseId,
        activeSkillPacks: parent.activeSkillPacks,
      }
      applyWorkflowRuntimeToState(sub)
      setWorkflowSubAgentState(sub, parent)

      const discoverable: Tool[] = [AskUserTool, SkillTool, WorkflowPhaseTool]
      const subTools: Tool[] = [
        ...discoverable,
        createToolSearchTool(discoverable),
      ]
      if (onProgress) {
        onProgress({ toolUseID: `wfm-${agentId}-start`, data: { type: 'agent_started', agentId, prompt: input.task.slice(0, 120) } })
      }

      const userMsg: Message = {
        role: 'user',
        content: buildManagerTask(input.task, parent),
      }
      sub.messages = [userMsg]

      const loop = agentLoop({
        state: sub,
        apiClient,
        tools: subTools,
        contextProviders: [dateContextProvider],
        canUseTool: allowAll,
        maxTurns: 8,
        signal: context.abortController.signal,
        askUser: context.askUser,
      })

      let turnCount = 0
      let resultText = ''
      let lastUsage: Usage = { inputTokens: 0, outputTokens: 0 }

      try {
        for (;;) {
          const n = await loop.next()
          if (n.done) {
            turnCount = n.value.turnCount
            break
          }
          const ev = n.value
          if (ev.type === 'text_delta') {
            resultText += ev.text
          }
          if (ev.type === 'message_end') {
            lastUsage = {
              inputTokens: lastUsage.inputTokens + ev.usage.inputTokens,
              outputTokens: lastUsage.outputTokens + ev.usage.outputTokens,
            }
          }
          if (onProgress) {
            onProgress({ toolUseID: `wfm-${agentId}-p`, data: { type: 'agent_event', agentId, event: ev } })
          }
        }
        accumulateUsage(parent, lastUsage, subModel)
      } catch (e) {
        return {
          data: {
            ok: false,
            result: `WorkflowManager error: ${(e as Error).message}`,
            turnCount,
            usage: lastUsage,
          },
        }
      }

      if (!resultText) {
        for (let i = sub.messages.length - 1; i >= 0; i--) {
          const msg = sub.messages[i]
          if (msg.role === 'assistant') {
            if (typeof msg.content === 'string') {
              resultText = msg.content
            } else {
              resultText = (msg.content as ContentBlock[]).filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
            }
            if (resultText) break
          }
        }
      }

      return {
        data: {
          ok: true,
          result: resultText || '[WorkflowManager completed with no text]',
          turnCount,
          usage: lastUsage,
        },
      }
    },
  }
}
