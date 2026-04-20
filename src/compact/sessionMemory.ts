/**
 * sessionMemory.ts — 跨会话 Session Memory
 *
 * 每次压缩后将摘要和结构化元数据持久化到：
 *   ~/.blino/memory/<projectHash>/memory.json
 *
 * 在新会话启动时，可选择注入上次会话的摘要作为初始上下文，
 * 避免从头重建对话背景。
 *
 * 元数据结构（SessionMemoryEntry）记录：
 *   - 会话 ID、时间戳、模型
 *   - 摘要文本
 *   - 结构化元数据：涉及的文件、完成的任务、待完成任务
 *   - token 统计
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Message, ContentBlock, ToolUseBlock } from '../types.js'
import { handleSilentError } from '../errors/handlers.js'

// ─── 类型定义 ────────────────────────────────────────────────────────────────────

export interface SessionMemoryMetadata {
  /** 本次会话中被创建或修改的文件路径 */
  filesModified: string[]
  /** 已完成的任务描述 */
  tasksCompleted: string[]
  /** 待完成的任务描述 */
  tasksRemaining: string[]
  /** 使用的模型 */
  model: string
  /** 总轮次数 */
  totalTurns: number
  /** 累计输入 token */
  totalInputTokens: number
  /** 累计输出 token */
  totalOutputTokens: number
}

export interface SessionMemoryEntry {
  sessionId: string
  timestamp: string
  /** 结构化摘要（来自 summaryCompact 的摘要文本） */
  summary: string
  metadata: SessionMemoryMetadata
}

export interface SessionMemoryStore {
  projectRoot: string
  lastUpdated: string
  /** 最多保留最近 5 次的会话记录 */
  sessions: SessionMemoryEntry[]
}

// ─── 路径工具 ────────────────────────────────────────────────────────────────────

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function getMemoryPath(projectRoot: string): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp'
  const hash = simpleHash(projectRoot)
  return resolve(homeDir, '.blino', 'memory', hash, 'memory.json')
}

// ─── 元数据提取（从 messages 中自动提取结构化信息）───────────────────────────────

/**
 * 从消息历史中自动提取：文件路径、工具调用等元数据
 */
export function extractMetadataFromMessages(
  messages: Message[],
  model: string,
  totalTurns: number,
  totalInputTokens: number,
  totalOutputTokens: number,
): SessionMemoryMetadata {
  const filesModified = new Set<string>()

  for (const msg of messages) {
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue

    const blocks = msg.content as ContentBlock[]
    for (const block of blocks) {
      if (block.type !== 'tool_use') continue

      const toolUse = block as ToolUseBlock
      // 提取文件路径相关工具调用
      if (['FileWrite', 'FileEdit', 'NotebookEdit'].includes(toolUse.name)) {
        const path = toolUse.input?.file_path || toolUse.input?.notebook_path
        if (typeof path === 'string') {
          filesModified.add(path)
        }
      }
    }
  }

  return {
    filesModified: [...filesModified],
    tasksCompleted: [],   // 从摘要中提取更准确，这里留空由摘要文本体现
    tasksRemaining: [],
    model,
    totalTurns,
    totalInputTokens,
    totalOutputTokens,
  }
}

// ─── 持久化 ───────────────────────────────────────────────────────────────────────

const MAX_SESSIONS_KEPT = 5

/**
 * 压缩完成后，将摘要和元数据写入 session memory 文件。
 */
export async function saveSessionMemory(
  projectRoot: string,
  sessionId: string,
  summaryText: string,
  metadata: SessionMemoryMetadata,
): Promise<void> {
  const filePath = getMemoryPath(projectRoot)

  try {
    await mkdir(resolve(filePath, '..'), { recursive: true })

    let store: SessionMemoryStore
    try {
      const raw = await readFile(filePath, 'utf-8')
      store = JSON.parse(raw) as SessionMemoryStore
    } catch {
      store = {
        projectRoot,
        lastUpdated: new Date().toISOString(),
        sessions: [],
      }
    }

    const entry: SessionMemoryEntry = {
      sessionId,
      timestamp: new Date().toISOString(),
      summary: summaryText,
      metadata,
    }

    // 去重：同一 sessionId 只保留最新
    store.sessions = store.sessions.filter(s => s.sessionId !== sessionId)
    store.sessions.push(entry)

    // 只保留最近 MAX_SESSIONS_KEPT 条
    if (store.sessions.length > MAX_SESSIONS_KEPT) {
      store.sessions = store.sessions.slice(-MAX_SESSIONS_KEPT)
    }

    store.lastUpdated = new Date().toISOString()

    await writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8')
  } catch (err) {
    handleSilentError(err, { context: 'sessionMemory_save', sessionId })
  }
}

/**
 * 加载最近一次会话的 memory entry（不含当前会话）。
 */
export async function loadLatestSessionMemory(
  projectRoot: string,
  currentSessionId: string,
): Promise<SessionMemoryEntry | null> {
  const filePath = getMemoryPath(projectRoot)

  try {
    const raw = await readFile(filePath, 'utf-8')
    const store = JSON.parse(raw) as SessionMemoryStore
    const others = store.sessions.filter(s => s.sessionId !== currentSessionId)
    return others.length > 0 ? others[others.length - 1] : null
  } catch {
    return null
  }
}

/**
 * 格式化 session memory 为可注入 context 的字符串。
 * 用于 ContextProvider 或首轮 system prompt 注入。
 */
export function formatSessionMemoryContext(entry: SessionMemoryEntry): string {
  const { summary, metadata, timestamp } = entry
  const date = new Date(timestamp).toLocaleString()

  const parts: string[] = [
    `# Previous Session Memory (${date})`,
    '',
    summary,
  ]

  if (metadata.filesModified.length > 0) {
    parts.push('', `## Files Modified in Previous Session`)
    metadata.filesModified.slice(0, 20).forEach(f => parts.push(`- ${f}`))
  }

  if (metadata.totalTurns > 0) {
    parts.push('', `_Session stats: ${metadata.totalTurns} turns, ${metadata.totalInputTokens} input tokens_`)
  }

  return parts.join('\n')
}

/**
 * 获取格式化的 session memory 上下文（供 ContextProvider 调用）。
 * 返回 null 表示无历史记录。
 */
export async function getSessionMemoryContext(
  projectRoot: string,
  currentSessionId: string,
): Promise<string | null> {
  const entry = await loadLatestSessionMemory(projectRoot, currentSessionId)
  if (!entry) return null
  return formatSessionMemoryContext(entry)
}
