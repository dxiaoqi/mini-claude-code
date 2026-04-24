import type { SessionState } from '../types.js'

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

export function setWorkflowPhaseById(state: SessionState, phaseId: string): { ok: boolean; message: string } {
  const id = phaseId?.trim()
  const phases = state.settings.projectPolicy?.phases
  if (!phases?.length) {
    return { ok: false, message: 'No workflow phases in .blino/workflow.json' }
  }
  if (!id) {
    return { ok: false, message: 'phaseId is required' }
  }
  const idx = phases.findIndex(p => p.id === id)
  if (idx < 0) {
    return { ok: false, message: `Unknown phase id "${id}". Valid: ${phases.map(p => p.id).join(', ')}` }
  }
  state.activePhaseIndex = idx
  applyWorkflowRuntimeToState(state)
  return { ok: true, message: `Phase: ${state.activePhaseId} (${idx + 1}/${phases.length})` }
}
