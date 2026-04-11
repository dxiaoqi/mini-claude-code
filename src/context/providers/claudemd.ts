/**
 * CLAUDE.md 上下文 — CLAUDE.md 多级发现与加载
 *
 * ContextProvider：聚合用户目录、项目根及从 cwd 向上遍历路径中的 CLAUDE.md、
 * .claude/rules 等约定位置，拼装为动态上下文片段注入会话。
 */
import { readFile, stat } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import type { ContextProvider, SessionState } from '../../types.js'

const CLAUDE_MD_FILES = [
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  '.claude/rules',
  'CLAUDE.local.md',
]

export const claudeMdProvider: ContextProvider = {
  name: 'claude_md',
  placement: 'dynamic',
  cacheBreak: false,
  priority: 20,

  async compute(session: SessionState): Promise<string | null> {
    const contents: string[] = []

    // User-level CLAUDE.md
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    if (homeDir) {
      const userMd = await tryReadFile(resolve(homeDir, '.claude', 'CLAUDE.md'))
      if (userMd) contents.push(`<!-- User-level CLAUDE.md -->\n${userMd}`)
    }

    // Walk from projectRoot up to cwd (they may be the same)
    const projectRoot = session.projectRoot
    const cwd = session.cwd

    // Project root level
    for (const relPath of CLAUDE_MD_FILES) {
      if (relPath.endsWith('/rules')) {
        const rulesContent = await loadRulesDir(resolve(projectRoot, '.claude', 'rules'))
        if (rulesContent) contents.push(rulesContent)
        continue
      }
      const content = await tryReadFile(resolve(projectRoot, relPath))
      if (content) contents.push(`<!-- ${relPath} -->\n${content}`)
    }

    // Walk from cwd up to projectRoot (skip projectRoot itself, already loaded)
    if (cwd !== projectRoot) {
      let dir = cwd
      while (dir !== projectRoot && dir !== dirname(dir)) {
        const md = await tryReadFile(resolve(dir, 'CLAUDE.md'))
        if (md) contents.push(`<!-- ${dir}/CLAUDE.md -->\n${md}`)
        dir = dirname(dir)
      }
    }

    if (contents.length === 0) return null

    return `## Project Instructions (CLAUDE.md)\n\n${contents.join('\n\n---\n\n')}`
  },
}

async function tryReadFile(path: string): Promise<string | null> {
  try {
    const s = await stat(path)
    if (!s.isFile()) return null
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

async function loadRulesDir(dirPath: string): Promise<string | null> {
  try {
    const s = await stat(dirPath)
    if (!s.isDirectory()) return null

    const { readdir } = await import('node:fs/promises')
    const files = await readdir(dirPath)
    const mdFiles = files.filter(f => f.endsWith('.md')).sort()

    const parts: string[] = []
    for (const file of mdFiles) {
      const content = await tryReadFile(resolve(dirPath, file))
      if (content) parts.push(`<!-- .claude/rules/${file} -->\n${content}`)
    }

    return parts.length > 0 ? parts.join('\n\n') : null
  } catch {
    return null
  }
}
