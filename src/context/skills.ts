/**
 * Skill 加载器 — Skill 加载器（YAML frontmatter 解析）
 *
 * 从用户与项目目录下的 .blino/skills 加载 Markdown 技能文件，解析 YAML
 * frontmatter（name、description、allowedTools）与正文 prompt，合并为 SkillDefinition 列表。
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { getBlinoDir } from '../utils/paths.js'

export interface SkillDefinition {
  name: string
  description: string
  allowedTools?: string[]
  prompt: string
  source: 'project' | 'user'
  filePath: string
}

export interface LoadSkillsOptions {
  /** 是否包含 `~/.blino/skills`（默认 true；阶段化 pack 模式通常为 false 以免混入用户全局） */
  includeUser?: boolean
  /**
   * 非空时只加载 `skills/<pack>/...` 下（递归）的 `.md`。
   * 每段为单级目录名，如 `["bootcamp", "day1"]` → `skills/bootcamp/day1`。
   */
  activateSkillPacks?: string[]
}

/**
 * Load skills from .blino/skills/ directories.
 * Skills are Markdown files with YAML frontmatter.
 *
 * Example:
 * ```markdown
 * ---
 * name: commit
 * description: Generate a commit message and commit
 * allowedTools: [Bash]
 * ---
 * Analyze staged changes, generate a Conventional Commits message, then execute git commit.
 * ```
 */
export async function loadSkills(
  projectRoot: string,
  options?: LoadSkillsOptions,
): Promise<SkillDefinition[]> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  const includeUser = options?.includeUser !== false
  const packs = options?.activateSkillPacks?.filter(s => s.length > 0)

  if (packs && packs.length > 0) {
    return loadSkillsForPacksOnly(projectRoot, homeDir, packs, includeUser)
  }

  const skills: SkillDefinition[] = []

  if (includeUser && homeDir) {
    const userSkillsDir = resolve(homeDir, getBlinoDir(), 'skills')
    const userSkills = await loadSkillsFromDirTopLevel(userSkillsDir, 'user')
    skills.push(...userSkills)
  }

  const projectSkillsDir = resolve(projectRoot, getBlinoDir(), 'skills')
  const projectSkills = await loadSkillsFromDirTopLevel(projectSkillsDir, 'project')
  skills.push(...projectSkills)

  return skills
}

/** 多 pack：每个根下递归加载；skill name 可能重复时后者覆盖列表顺序（后加载优先） */
async function loadSkillsForPacksOnly(
  projectRoot: string,
  homeDir: string,
  packs: string[],
  includeUser: boolean,
): Promise<SkillDefinition[]> {
  const out: SkillDefinition[] = []
  const userRoot = homeDir ? resolve(homeDir, getBlinoDir(), 'skills') : null
  const projectRootDir = resolve(projectRoot, getBlinoDir(), 'skills')

  for (const pack of packs) {
    if (pack.includes('..') || pack.includes('/') || pack.includes('\\')) {
      continue
    }
    if (includeUser && userRoot) {
      out.push(
        ...await loadSkillsFromDirRecursive(resolve(userRoot, pack), 'user'),
      )
    }
    out.push(
      ...await loadSkillsFromDirRecursive(resolve(projectRootDir, pack), 'project'),
    )
  }
  return dedupeSkillsByName(out)
}

function dedupeSkillsByName(skills: SkillDefinition[]): SkillDefinition[] {
  const byName = new Map<string, SkillDefinition>()
  for (const s of skills) {
    byName.set(s.name, s)
  }
  return [...byName.values()]
}

async function loadSkillsFromDirTopLevel(
  dir: string,
  source: 'project' | 'user',
): Promise<SkillDefinition[]> {
  try {
    const s = await stat(dir)
    if (!s.isDirectory()) return []
  } catch {
    return []
  }

  const files = await readdir(dir, { withFileTypes: true })
  const skills: SkillDefinition[] = []

  for (const ent of files) {
    if (ent.isDirectory()) continue
    if (ent.isFile() && extname(ent.name) === '.md') {
      const filePath = resolve(dir, ent.name)
      try {
        const content = await readFile(filePath, 'utf-8')
        const skill = parseSkillFile(content, filePath, source)
        if (skill) skills.push(skill)
      } catch { /* skip */ }
    }
  }

  return skills
}

/**
 * 递归收集目录下所有 `.md`（不跟随符号链接到目录外；跳过隐藏目录名）。
 */
async function loadSkillsFromDirRecursive(
  dir: string,
  source: 'project' | 'user',
): Promise<SkillDefinition[]> {
  try {
    const s = await stat(dir)
    if (!s.isDirectory()) return []
  } catch {
    return []
  }

  const out: SkillDefinition[] = []
  const walk = await readdir(dir, { withFileTypes: true })

  for (const ent of walk) {
    if (ent.name.startsWith('.')) continue
    const full = resolve(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...await loadSkillsFromDirRecursive(full, source))
    } else if (ent.isFile() && extname(ent.name) === '.md') {
      try {
        const content = await readFile(full, 'utf-8')
        const skill = parseSkillFile(content, full, source)
        if (skill) out.push(skill)
      } catch { /* skip */ }
    }
  }

  return out
}

function parseSkillFile(
  content: string,
  filePath: string,
  source: 'project' | 'user',
): SkillDefinition | null {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)

  if (!frontmatterMatch) {
    // No frontmatter — use filename as name, entire content as prompt
    const name = filePath.split('/').pop()?.replace('.md', '') || 'unnamed'
    return {
      name,
      description: `Skill: ${name}`,
      prompt: content.trim(),
      source,
      filePath,
    }
  }

  const frontmatter = frontmatterMatch[1]
  const body = frontmatterMatch[2].trim()

  const name = extractField(frontmatter, 'name') || filePath.split('/').pop()?.replace('.md', '') || 'unnamed'
  const description = extractField(frontmatter, 'description') || `Skill: ${name}`
  const allowedToolsRaw = extractField(frontmatter, 'allowedTools')

  let allowedTools: string[] | undefined
  if (allowedToolsRaw) {
    try {
      allowedTools = JSON.parse(allowedToolsRaw.replace(/'/g, '"'))
    } catch {
      allowedTools = allowedToolsRaw
        .replace(/[\[\]]/g, '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    }
  }

  return {
    name,
    description,
    allowedTools,
    prompt: body,
    source,
    filePath,
  }
}

function extractField(frontmatter: string, field: string): string | null {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
  return match ? match[1].trim() : null
}
