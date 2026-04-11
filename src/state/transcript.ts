/**
 * state/transcript.ts — Transcript 持久化
 *
 * 将会话消息以 JSONL 追加写入 ~/.mini-claude/projects 下的会话文件。
 */
import { writeFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import type { Message, SessionState } from '../types.js'
import { handleSilentError } from '../errors/handlers.js'

/**
 * Get the transcript directory for a project.
 * ~/.mini-claude/projects/<hash>/
 */
function getTranscriptDir(projectRoot: string): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp'
  const hash = simpleHash(projectRoot)
  return resolve(homeDir, '.mini-claude', 'projects', hash)
}

function getTranscriptPath(projectRoot: string, sessionId: string): string {
  return resolve(getTranscriptDir(projectRoot), `${sessionId}.jsonl`)
}

/**
 * Append a message to the session transcript file (JSONL format).
 */
export async function recordTranscript(
  state: SessionState,
  message: Message,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const filePath = getTranscriptPath(state.projectRoot, state.sessionId)

  try {
    await mkdir(dirname(filePath), { recursive: true })

    const entry = {
      timestamp: new Date().toISOString(),
      role: message.role,
      content: message.content,
      ...metadata,
    }

    await writeFile(filePath, JSON.stringify(entry) + '\n', { flag: 'a' })
  } catch (err) {
    handleSilentError(err, {
      sessionId: state.sessionId,
      filePath,
      context: 'transcript_write',
    })
  }
}

/**
 * Flush complete session state to transcript.
 */
export async function flushTranscript(state: SessionState): Promise<void> {
  const filePath = getTranscriptPath(state.projectRoot, state.sessionId)

  try {
    await mkdir(dirname(filePath), { recursive: true })

    const header = {
      type: 'session_header',
      sessionId: state.sessionId,
      model: state.model,
      cwd: state.cwd,
      projectRoot: state.projectRoot,
      timestamp: new Date().toISOString(),
      totalInputTokens: state.totalInputTokens,
      totalOutputTokens: state.totalOutputTokens,
    }

    const lines = [JSON.stringify(header)]
    for (const msg of state.messages) {
      lines.push(JSON.stringify({
        timestamp: new Date().toISOString(),
        role: msg.role,
        content: msg.content,
      }))
    }

    await writeFile(filePath, lines.join('\n') + '\n')
  } catch (err) {
    handleSilentError(err, {
      sessionId: state.sessionId,
      filePath,
      context: 'transcript_flush',
    })
  }
}

/**
 * Load a previous session's messages from transcript.
 */
export async function loadTranscript(
  projectRoot: string,
  sessionId: string,
): Promise<Message[]> {
  const filePath = getTranscriptPath(projectRoot, sessionId)

  try {
    const content = await readFile(filePath, 'utf-8')
    const lines = content.trim().split('\n')
    const messages: Message[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.type === 'session_header') continue
        if (entry.role && entry.content !== undefined) {
          messages.push({ role: entry.role, content: entry.content })
        }
      } catch (err) {
        handleSilentError(err, {
          filePath,
          context: 'transcript_read',
          line,
        })
      }
    }

    return messages
  } catch (err) {
    handleSilentError(err, {
      filePath,
      context: 'transcript_read',
    })
    return []
  }
}

/**
 * List available sessions for a project.
 */
export async function listSessions(
  projectRoot: string,
): Promise<Array<{ sessionId: string; modifiedAt: Date }>> {
  const dir = getTranscriptDir(projectRoot)

  try {
    const files = await readdir(dir)
    const sessions: Array<{ sessionId: string; modifiedAt: Date }> = []

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const sessionId = file.replace('.jsonl', '')
      try {
        const s = await stat(resolve(dir, file))
        sessions.push({ sessionId, modifiedAt: s.mtime })
      } catch {
        continue
      }
    }

    return sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
  } catch {
    return []
  }
}

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}
