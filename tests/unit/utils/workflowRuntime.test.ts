import { describe, it, expect } from 'vitest'
import { createSessionState, clearSession } from '../../../src/state/SessionState.js'
import { applyWorkflowRuntimeToState, setWorkflowPhaseById } from '../../../src/utils/workflowRuntime.js'
import type { Settings } from '../../../src/types.js'

describe('workflowRuntime', () => {
  const policy = {
    schemaVersion: 1,
    profile: 'p',
    phases: [
      { id: 'a', activateSkillPacks: ['p1'] },
      { id: 'b', notes: 'n', activateSkillPacks: ['p2'] },
    ],
  } as const

  it('applies first phase and packs', () => {
    const s = createSessionState({ cwd: '/tmp', settings: { projectPolicy: { ...policy } } as Settings })
    expect(s.activePhaseId).toBe('a')
    expect(s.activeSkillPacks).toEqual(['p1'])
  })

  it('setWorkflowPhaseById by id', () => {
    const s = createSessionState({ cwd: '/tmp', settings: { projectPolicy: { ...policy } } as Settings })
    const r = setWorkflowPhaseById(s, 'b')
    expect(r.ok).toBe(true)
    expect(s.activePhaseId).toBe('b')
  })

  it('clearSession resets phase', () => {
    const s = createSessionState({ cwd: '/tmp', settings: { projectPolicy: { ...policy } } as Settings })
    setWorkflowPhaseById(s, 'b')
    clearSession(s)
    expect(s.activePhaseId).toBe('a')
  })
})
