import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'

// Use real fs for these tests (global setup stubs node:fs/promises)
vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return { ...m }
})
import { resolve, join } from 'node:path'
import { loadWorkflowPolicy, getWorkflowPath, mergeSettingsWithPolicy } from '../../../src/utils/workflow.js'
import { getBlinoDir } from '../../../src/utils/paths.js'
import { loadSettings } from '../../../src/utils/config.js'
import { tmpdir } from 'node:os'

describe('workflow policy', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blino-wf-'))
    const bl = join(dir, getBlinoDir())
    await mkdir(bl, { recursive: true })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('getWorkflowPath ends with workflow.json under blino dir', () => {
    const p = getWorkflowPath(dir)
    expect(p).toContain('workflow.json')
    expect(p).toContain(getBlinoDir())
  })

  it('loadWorkflowPolicy returns null when file missing', async () => {
    const { policy, error } = await loadWorkflowPolicy(dir)
    expect(policy).toBeNull()
    expect(error).toBeUndefined()
  })

  it('loadWorkflowPolicy parses valid workflow.json', async () => {
    const valid = {
      schemaVersion: 1,
      profile: 'training',
      phases: [{ id: 'p1', notes: 'a', activateSkillPacks: ['x'] }],
    }
    await writeFile(getWorkflowPath(dir), JSON.stringify(valid), 'utf-8')
    const { policy, error } = await loadWorkflowPolicy(dir)
    expect(error).toBeUndefined()
    expect(policy?.schemaVersion).toBe(1)
    expect(policy?.profile).toBe('training')
    expect(policy?.phases?.[0].id).toBe('p1')
  })

  it('loadWorkflowPolicy rejects invalid file with error', async () => {
    await writeFile(getWorkflowPath(dir), JSON.stringify({ schemaVersion: 'x' }), 'utf-8')
    const { policy, error } = await loadWorkflowPolicy(dir)
    expect(policy).toBeNull()
    expect(error).toBeDefined()
  })

  it('loadSettings includes projectPolicy when workflow valid', async () => {
    const valid = { schemaVersion: 1, profile: 'default' }
    await writeFile(join(dir, getBlinoDir(), 'workflow.json'), JSON.stringify(valid), 'utf-8')
    const s = await loadSettings(dir)
    expect(s.projectPolicy?.schemaVersion).toBe(1)
  })

  it('mergeSettingsWithPolicy sets projectPolicy', () => {
    const s = mergeSettingsWithPolicy(
      { model: 'm' },
      { schemaVersion: 1, profile: 'p' },
    )
    expect(s.projectPolicy?.profile).toBe('p')
  })
})
