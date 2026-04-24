import type { SessionState } from '../../types.js'

const parentBySub = new WeakMap<SessionState, SessionState>()

export function setWorkflowSubAgentState(sub: SessionState, parent: SessionState): void {
  parentBySub.set(sub, parent)
}

export function getWorkflowParentState(sub: SessionState): SessionState | undefined {
  return parentBySub.get(sub)
}
