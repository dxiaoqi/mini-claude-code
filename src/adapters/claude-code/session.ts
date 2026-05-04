import { randomUUID } from 'node:crypto'

export interface CCSession {
  /** 本地生成的 session key，用于 HTTP 路由 */
  localId: string
  /** Claude Code 返回的 session_id（system/init 事件后更新） */
  claudeSessionId: string | null
  createdAt: Date
  lastActiveAt: Date
  cwd: string
}

export class ClaudeCodeSessionManager {
  private sessions = new Map<string, CCSession>()

  create(cwd: string): CCSession {
    const session: CCSession = {
      localId: randomUUID(),
      claudeSessionId: null,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      cwd,
    }
    this.sessions.set(session.localId, session)
    return session
  }

  get(localId: string): CCSession | undefined {
    return this.sessions.get(localId)
  }

  list(): CCSession[] {
    return [...this.sessions.values()].sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime()
    )
  }

  touch(localId: string): void {
    const s = this.sessions.get(localId)
    if (s) s.lastActiveAt = new Date()
  }

  /** Claude Code 返回 session_id 后更新 */
  setClaudeSessionId(localId: string, claudeSessionId: string): void {
    const s = this.sessions.get(localId)
    if (s) s.claudeSessionId = claudeSessionId
  }

  delete(localId: string): void {
    this.sessions.delete(localId)
  }
}
