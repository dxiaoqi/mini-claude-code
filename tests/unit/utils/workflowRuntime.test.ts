import { describe, it, expect } from 'vitest'
import { createSessionState, clearSession } from '../../../src/state/SessionState.js'
import { applyWorkflowRuntimeToState, advanceWorkflowPhase } from '../../../src/utils/workflowRuntime.js'
import type { Settings } from '../../../src/types.js'

describe('workflowRuntime', () => {
  const policy = {
    schemaVersion: 1,
    profile: 'training',
    phases: [
      { id: 'a', activateSkillPacks: ['p1'] },
      { id: 'b', notes: 'second', activateSkillPacks: ['p2'] },
    ],
  } as const

  it('applyWorkflowRuntimeToState sets first phase and packs', () => {
    const s = createSessionState({
      cwd: '/tmp',
      settings: { projectPolicy: { ...policy } } as Settings,
    })
    expect(s.activePhaseIndex).toBe(0)
    expect(s.activePhaseId).toBe('a')
    expect(s.activeSkillPacks).toEqual(['p1'])
  })

  it('advanceWorkflowPhase updates phase and skills', () => {
    const s = createSessionState({
      cwd: '/tmp',
      settings: { projectPolicy: { ...policy } } as Settings,
    })
    const r = advanceWorkflowPhase(s, 1)
    expect(r.ok).toBe(true)
    expect(s.activePhaseId).toBe('b')
    expect(s.activeSkillPacks).toEqual(['p2'])
  })

  it('clearSession keeps workflow but resets to phase 0', () => {
    const s = createSessionState({
      cwd: '/tmp',
      settings: { projectPolicy: { ...policy } } as Settings,
    })
    advanceWorkflowPhase(s, 1)
    clearSession(s)
    expect(s.activePhaseIndex).toBe(0)
    expect(s.activePhaseId).toBe('a')
  })

  it('advanceWorkflowPhase is no-op message without policy', () => {
    const s = createSessionState({ cwd: '/tmp', settings: {} })
    const r = advanceWorkflowPhase(s, 1)
    expect(r.ok).toBe(false)
  })
})
