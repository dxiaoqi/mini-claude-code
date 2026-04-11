/**
 * Git 上下文 — Git 状态上下文提供者
 *
 * ContextProvider：在工作目录执行 git 获取当前分支、简短状态、最近提交与 user.name，
 * 输出为 Markdown；非仓库或命令失败时返回 null，并标记为需随仓库变化失效的缓存。
 */
import { execFile } from 'node:child_process'
import type { ContextProvider, SessionState } from '../../types.js'

export const gitContextProvider: ContextProvider = {
  name: 'git_status',
  placement: 'dynamic',
  cacheBreak: true,
  priority: 80,

  async compute(session: SessionState): Promise<string | null> {
    try {
      const [branch, status, log, userName] = await Promise.all([
        gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], session.cwd),
        gitExec(['status', '--short', '--branch'], session.cwd),
        gitExec(['log', '--oneline', '-5'], session.cwd),
        gitExec(['config', 'user.name'], session.cwd),
      ])

      if (!branch) return null

      const parts = [`## Git Status`, `Branch: ${branch.trim()}`]

      if (userName.trim()) {
        parts.push(`User: ${userName.trim()}`)
      }

      if (status.trim()) {
        parts.push(`\`\`\`\n${status.trim()}\n\`\`\``)
      }

      if (log.trim()) {
        parts.push(`Recent commits:\n\`\`\`\n${log.trim()}\n\`\`\``)
      }

      return parts.join('\n')
    } catch {
      return null
    }
  },
}

function gitExec(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 5000 }, (err, stdout) => {
      resolve(err ? '' : stdout)
    })
  })
}
