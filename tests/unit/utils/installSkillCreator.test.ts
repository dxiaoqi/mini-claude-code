import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installSkillCreator } from '../../../src/utils/installSkillCreator.js'
import { getBlinoDir } from '../../../src/utils/paths.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return { ...m }
})

describe('installSkillCreator', () => {
  let root: string
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('writes skill-creator.md from template', async () => {
    root = await mkdtemp(join(tmpdir(), 'blino-sc-'))
    const r = await installSkillCreator(root)
    expect(r.ok).toBe(true)
    expect(r.created).toBe(true)
    const text = await readFile(join(root, getBlinoDir(), 'skills', 'skill-creator.md'), 'utf-8')
    expect(text).toContain('name: skill-creator')
  })

  it('skips when exists without force', async () => {
    root = await mkdtemp(join(tmpdir(), 'blino-sc-'))
    const p = join(root, getBlinoDir(), 'skills')
    await mkdir(p, { recursive: true })
    await writeFile(join(p, 'skill-creator.md'), 'old', 'utf-8')
    const r = await installSkillCreator(root)
    expect(r.created).toBe(false)
    expect((await readFile(join(p, 'skill-creator.md'), 'utf-8'))).toBe('old')
  })

  it('overwrites with force', async () => {
    root = await mkdtemp(join(tmpdir(), 'blino-sc-'))
    const p = join(root, getBlinoDir(), 'skills')
    await mkdir(p, { recursive: true })
    await writeFile(join(p, 'skill-creator.md'), 'old', 'utf-8')
    const r = await installSkillCreator(root, { force: true })
    expect(r.ok).toBe(true)
    const text = await readFile(join(p, 'skill-creator.md'), 'utf-8')
    expect(text).toContain('name: skill-creator')
  })
})
