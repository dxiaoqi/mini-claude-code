import { mkdir, writeFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getBlinoDir } from '../utils/paths.js'
import { invalidateSkillCache } from '../tools/interaction/SkillTool.js'
import { loadSettings } from '../utils/config.js'
import { applyWorkflowRuntimeToState } from '../utils/workflowRuntime.js'
import type { SessionState, Settings } from '../types.js'

const SAFE = /^[a-zA-Z0-9._-]+\.md$/

export function isSafeSkillFileName(name: string): boolean {
  return SAFE.test(name) && !name.includes('..')
}

export function extractBlinoSkillBlock(assistantText: string): string | null {
  const m = assistantText.match(/```blino-skill\r?\n([\s\S]*?)```/)
  if (!m) return null
  return m[1].trim()
}

/**
 * 写入 .blino/skills/<fileName> 并刷新会话 skill 缓存
 */
export async function writeProjectSkill(
  projectRoot: string,
  fileName: string,
  content: string,
  options?: { sessionId?: string },
): Promise<{ path: string }> {
  if (!isSafeSkillFileName(fileName)) {
    throw new Error('Invalid file name. Use only letters, numbers, ._- and end with .md')
  }
  const dir = resolve(projectRoot, getBlinoDir(), 'skills')
  await mkdir(dir, { recursive: true })
  const path = join(dir, fileName)
  await writeFile(path, content, 'utf-8')
  if (options?.sessionId) {
    invalidateSkillCache(options.sessionId)
  } else {
    invalidateSkillCache()
  }
  return { path }
}

/** 列出项目 `.blino/skills` 下所有 `.md` 相对路径（正斜杠） */
export async function listProjectSkillRelPaths(projectRoot: string): Promise<string[]> {
  const root = resolve(projectRoot, getBlinoDir(), 'skills')
  const out: string[] = []
  async function walk(dir: string, rel: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        await walk(full, relPath)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(relPath.replace(/\\/g, '/'))
      }
    }
  }
  await walk(root, '')
  return out.sort((a, b) => a.localeCompare(b))
}

/**
 * 从磁盘重载设置并同步 workflow 阶段到 state；清空 prompt 区缓存
 */
export async function reloadSettingsIntoSession(
  state: SessionState,
): Promise<void> {
  const s = (await loadSettings(state.projectRoot).catch(() => ({}))) as Settings
  state.settings = { ...state.settings, ...s }
  applyWorkflowRuntimeToState(state)
  state.systemPromptSectionCache.clear()
}
