/**
 * 更新项目工作流阶段（.blino/workflow.json 中 phases[].id）
 */
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'
import { invalidateSkillCache } from '../interaction/SkillTool.js'
import { setWorkflowPhaseById, applyWorkflowRuntimeToState } from '../../utils/workflowRuntime.js'
import { loadWorkflowPolicy, mergeSettingsWithPolicy } from '../../utils/workflow.js'
import { getWorkflowParentState } from './workflowSubAgentState.js'
import type { SessionState } from '../../types.js'

const inputSchema = z.object({
  phaseId: z.string().min(1).describe('Target phase id from workflow.json'),
  reason: z.string().optional().describe('Short reason for logs / user'),
})

type Input = z.infer<typeof inputSchema>
type Output = { ok: boolean; message: string; activePhaseId?: string; activePhaseIndex?: number }

function modeAllowsThisTool(state: SessionState): 'advisory' | 'sub' | null {
  const parent = getWorkflowParentState(state)
  if (parent) {
    return parent.settings.workflowManager?.mode === 'auto' ? 'sub' : null
  }
  return state.settings.workflowManager?.mode === 'advisory' ? 'advisory' : null
}

function syncParentPhaseFromChild(sub: SessionState): void {
  const parent = getWorkflowParentState(sub)
  if (!parent) return
  parent.activePhaseIndex = sub.activePhaseIndex
  applyWorkflowRuntimeToState(parent)
  parent.systemPromptSectionCache.clear()
  invalidateSkillCache(parent.sessionId)
  invalidateSkillCache(sub.sessionId)
}

export const WorkflowPhaseTool: Tool<Input, Output> = {
  name: 'WorkflowPhase',
  description: 'Set the project workflow to a specific phase id (from .blino/workflow.json). Updates which skill packs apply.',

  inputSchema,
  shouldDefer: true,
  alwaysLoad: false,

  shouldIncludeInApi(ctx) {
    return modeAllowsThisTool(ctx.state) !== null
  },

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const st = context.sessionState
    const allow = modeAllowsThisTool(st)
    if (!allow) {
      return {
        data: {
          ok: false,
          message: 'WorkflowPhase is only available in advisory mode (main agent) or inside WorkflowManager (auto).',
        },
      }
    }

    const { policy } = await loadWorkflowPolicy(st.projectRoot)
    if (policy) {
      st.settings = mergeSettingsWithPolicy(st.settings, policy) as typeof st.settings
    }

    const r = setWorkflowPhaseById(st, input.phaseId)
    if (r.ok) {
      if (allow === 'sub') {
        syncParentPhaseFromChild(st)
      } else {
        invalidateSkillCache(st.sessionId)
      }
      st.systemPromptSectionCache.clear()
    }

    const reasonLine = input.reason?.trim() ? ` ${input.reason.trim()}` : ''
    return {
      data: {
        ok: r.ok,
        message: (r.ok ? r.message : r.message) + (reasonLine ? ` —${reasonLine}` : ''),
        activePhaseId: st.activePhaseId,
        activePhaseIndex: st.activePhaseIndex,
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
