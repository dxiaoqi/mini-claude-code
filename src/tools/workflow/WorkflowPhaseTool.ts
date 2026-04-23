/**
 * WorkflowPhase — 在 advisory/auto 模式下由主 Agent 推进项目工作流阶段（与 workflow.json 对齐）。
 */
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'
import { invalidateSkillCache } from '../interaction/SkillTool.js'
import { setWorkflowPhaseById } from '../../utils/workflowRuntime.js'
import { loadWorkflowPolicy, mergeSettingsWithPolicy } from '../../utils/workflow.js'

const inputSchema = z.object({
  /** Must match a phase `id` in .blino/workflow.json */
  phaseId: z.string().min(1).describe('Target workflow phase id (must exist in workflow.json)'),
  /** Short justification for the user and logs (why this phase now) */
  reason: z.string().optional().describe('Brief reason (shown to the user)'),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  ok: boolean
  message: string
  activePhaseId?: string
  activePhaseIndex?: number
}

function workflowModeAllowsAgent(state: { settings: { workflowManager?: { mode?: string } } }): boolean {
  const m = state.settings.workflowManager?.mode ?? 'manual'
  return m === 'advisory' || m === 'auto'
}

export const WorkflowPhaseTool: Tool<Input, Output> = {
  name: 'WorkflowPhase',
  aliases: ['WorkflowPhaseTool'],
  description: `Advance the project workflow to a specific phase (must match an id in .blino/workflow.json). This updates which skill packs are visible to Skill. Only use when the project workflowManager mode is advisory or auto and the user (or the task) clearly calls for that phase.`,

  inputSchema,
  shouldDefer: true,
  alwaysLoad: false,

  shouldIncludeInApi(ctx) {
    return workflowModeAllowsAgent(ctx.state)
  },

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const state = context.sessionState
    if (!workflowModeAllowsAgent(state)) {
      return {
        data: {
          ok: false,
          message: 'WorkflowPhase is not enabled: set workflowManager.mode to "advisory" or "auto" in .blino/settings (project panel switch).',
        },
      }
    }

    // Re-read policy so phase list matches disk if workflow.json changed without full reload
    const { policy } = await loadWorkflowPolicy(state.projectRoot)
    if (policy) {
      state.settings = mergeSettingsWithPolicy(state.settings, policy) as typeof state.settings
    }

    const r = setWorkflowPhaseById(state, input.phaseId)
    if (r.ok) {
      invalidateSkillCache(state.sessionId)
      state.systemPromptSectionCache.clear()
    }

    const reasonLine = input.reason?.trim()
      ? ` Reason: ${input.reason.trim()}`
      : ''

    return {
      data: {
        ok: r.ok,
        message: r.ok
          ? `${r.message || 'Phase updated'}.${reasonLine}`
          : `${r.message}${reasonLine}`,
        activePhaseId: state.activePhaseId,
        activePhaseIndex: state.activePhaseIndex,
      },
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.message,
      is_error: !output.ok,
    }
  },
}
