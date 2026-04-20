/**
 * Skill 加载器 — Skill 加载器（YAML frontmatter 解析）
 *
 * 从用户与项目目录下的 .lino/skills 加载 Markdown 技能文件，解析 YAML
 * frontmatter（name、description、allowedTools）与正文 prompt，合并为 SkillDefinition 列表。
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, extname } from 'node:path'

export interface SkillDefinition {
  name: string
  description: string
  allowedTools?: string[]
  prompt: string
  source: 'project' | 'user'
  filePath: string
}

/**
 * Load skills from .lino/skills/ directories.
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
export async function loadSkills(projectRoot: string): Promise<SkillDefinition[]> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  const skills: SkillDefinition[] = []

  // User-level skills
  if (homeDir) {
    const userSkillsDir = resolve(homeDir, '.lino', 'skills')
    const userSkills = await loadSkillsFromDir(userSkillsDir, 'user')
    skills.push(...userSkills)
  }

  // Project-level skills
  const projectSkillsDir = resolve(projectRoot, '.lino', 'skills')
  const projectSkills = await loadSkillsFromDir(projectSkillsDir, 'project')
  skills.push(...projectSkills)

  return skills
}

async function loadSkillsFromDir(
  dir: string,
  source: 'project' | 'user',
): Promise<SkillDefinition[]> {
  try {
    const s = await stat(dir)
    if (!s.isDirectory()) return []
  } catch {
    return []
  }

  const files = await readdir(dir)
  const mdFiles = files.filter(f => extname(f) === '.md')
  const skills: SkillDefinition[] = []

  for (const file of mdFiles) {
    const filePath = resolve(dir, file)
    try {
      const content = await readFile(filePath, 'utf-8')
      const skill = parseSkillFile(content, filePath, source)
      if (skill) skills.push(skill)
    } catch {
      // Skip unparseable files
    }
  }

  return skills
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
