/**
 * MEMORY 上下文 — MEMORY.md 加载（200 行 / 25KB 限制）
 *
 * ContextProvider：读取用户与项目下 .claude/MEMORY.md，按最大行数与字节上限截断，
 * 格式化为「Memory」章节供模型使用。
 */
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ContextProvider, SessionState } from '../../types.js'

const MAX_LINES = 200
const MAX_BYTES = 25_000

export const memoryProvider: ContextProvider = {
  name: 'memory',
  placement: 'dynamic',
  cacheBreak: false,
  priority: 30,

  async compute(session: SessionState): Promise<string | null> {
    const parts: string[] = []

    // User-level MEMORY.md
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    if (homeDir) {
      const userMemory = await tryReadMemory(resolve(homeDir, '.claude', 'MEMORY.md'))
      if (userMemory) parts.push(`### User Memory\n${userMemory}`)
    }

    // Project-level MEMORY.md
    const projectMemory = await tryReadMemory(resolve(session.projectRoot, '.claude', 'MEMORY.md'))
    if (projectMemory) parts.push(`### Project Memory\n${projectMemory}`)

    if (parts.length === 0) return null

    return `## Memory\n\n${parts.join('\n\n')}`
  },
}

async function tryReadMemory(path: string): Promise<string | null> {
  try {
    const s = await stat(path)
    if (!s.isFile()) return null

    const raw = await readFile(path, 'utf-8')
    return truncate(raw)
  } catch {
    return null
  }
}

function truncate(content: string): string {
  const lines = content.split('\n')
  let result = content

  if (lines.length > MAX_LINES) {
    result = lines.slice(0, MAX_LINES).join('\n')
    result += `\n\n[Truncated: ${lines.length - MAX_LINES} lines omitted]`
  }

  const bytes = Buffer.byteLength(result, 'utf-8')
  if (bytes > MAX_BYTES) {
    const lastNewline = result.lastIndexOf('\n', MAX_BYTES)
    result = result.slice(0, lastNewline > 0 ? lastNewline : MAX_BYTES)
    result += '\n\n[Truncated: exceeded 25KB limit]'
  }

  return result
}
