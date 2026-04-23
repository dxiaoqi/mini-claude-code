/**
 * 将 `workflow.json` 中的 phases 与 SessionState 运行时对齐（P2）。
 * 不重复解析磁盘上的 workflow 文件，只读 `state.settings.projectPolicy`。
 */
import type { SessionState } from '../types.js'

/**
 * 根据 `projectPolicy` 的当前 `activePhaseIndex` 写入
 * `activePhaseId` / `activeSkillPacks`。
 * 无 phases 或无效 index 时清空运行时字段（等价于不启用阶段化 skill 包）。
 */
export function applyWorkflowRuntimeToState(state: SessionState): void {
  const policy = state.settings.projectPolicy
  const phases = policy?.phases
  if (!phases || phases.length === 0) {
    state.activePhaseId = undefined
    state.activeSkillPacks = undefined
    return
  }

  let idx = state.activePhaseIndex ?? 0
  if (idx < 0) idx = 0
  if (idx >= phases.length) idx = phases.length - 1

  state.activePhaseIndex = idx
  const phase = phases[idx]
  state.activePhaseId = phase.id
  const raw = phase.activateSkillPacks
  state.activeSkillPacks = raw && raw.length > 0 ? [...raw] : undefined
}

export interface AdvancePhaseResult {
  ok: boolean
  message: string
  activePhaseId?: string
  activePhaseIndex?: number
}

/**
 * 前进（或回退）workflow 阶段；delta 默认 +1。超出范围时钳在首/末阶段。
 */
export function advanceWorkflowPhase(
  state: SessionState,
  delta = 1,
): AdvancePhaseResult {
  const phases = state.settings.projectPolicy?.phases
  if (!phases?.length) {
    return { ok: false, message: 'No workflow phases in project .blino/workflow.json' }
  }

  let idx = (state.activePhaseIndex ?? 0) + delta
  if (idx < 0) idx = 0
  if (idx >= phases.length) idx = phases.length - 1

  state.activePhaseIndex = idx
  applyWorkflowRuntimeToState(state)
  return {
    ok: true,
    message: `Phase: ${state.activePhaseId} (${(idx + 1)}/${phases.length})`,
    activePhaseId: state.activePhaseId,
    activePhaseIndex: idx,
  }
}
