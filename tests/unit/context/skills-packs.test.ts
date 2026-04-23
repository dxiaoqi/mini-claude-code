import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadSkills } from '../../../src/context/skills.js'
import { getBlinoDir } from '../../../src/utils/paths.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return { ...m }
})

describe('loadSkills activateSkillPacks', () => {
  let projectRoot: string
  const md = (name: string) => `---\nname: ${name}\ndescription: d\n---\nbody\n`

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'blino-sk-'))
    const skills = join(projectRoot, getBlinoDir(), 'skills')
    await mkdir(join(skills, 'pack-a'), { recursive: true })
    await writeFile(join(skills, 'root.md'), md('root-skill'), 'utf-8')
    await writeFile(join(skills, 'pack-a', 'inner.md'), md('pack-a-skill'), 'utf-8')
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
  })

  it('loads only root .md when no options', async () => {
    const s = await loadSkills(projectRoot, { includeUser: false })
    const names = s.map(x => x.name).sort()
    expect(names).toEqual(['root-skill'])
  })

  it('loads recursive md under listed packs only', async () => {
    const s = await loadSkills(projectRoot, {
      includeUser: false,
      activateSkillPacks: ['pack-a'],
    })
    expect(s.map(x => x.name)).toEqual(['pack-a-skill'])
  })
})
