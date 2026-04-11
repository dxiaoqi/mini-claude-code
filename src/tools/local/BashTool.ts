/**
 * BashTool — Shell 命令执行工具
 *
 * 通过子进程执行 Shell 命令；结合命令分类将风险划分为四级：safe_read、safe_write、
 * needs_confirmation、dangerous，用于权限判断以及只读/破坏性等策略。
 */
import { spawn } from 'node:child_process'
import { z } from 'zod'
import { classifyBashCommand } from '../../permissions/bashClassifier.js'
import { getLogger } from '../../logging/index.js'
import type { PermissionResult, Tool, ToolContext, ToolResult } from '../../types.js'

const inputSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

export const BashTool: Tool<Input, Output> = {
  name: 'Bash',
  aliases: ['BashTool'],
  description: 'Execute a shell command. Use for running scripts, installing packages, managing files, git operations, and any system command.',

  inputSchema,

  isReadOnly(input) {
    return classifyBashCommand(input.command).risk === 'safe_read'
  },

  isDestructive(input) {
    return classifyBashCommand(input.command).risk === 'dangerous'
  },

  isConcurrencySafe() {
    return false
  },

  async checkPermissions(input, context): Promise<PermissionResult> {
    const classification = classifyBashCommand(input.command)

    // Log permission decision
    const logger = context.logger ? context.logger as any : null
    if (logger) {
      logger.logSecurityEvent({
        type: 'permission_decision',
        toolName: this.name,
        decision: classification.risk === 'dangerous' ? 'deny' :
                  classification.risk === 'safe_read' ? 'allow' :
                  classification.risk === 'safe_write' ? 'allow' : 'ask',
        reason: classification.reason,
        riskLevel: classification.risk as any,
        sessionId: context.sessionState.sessionId,
        command: input.command,
      })
    }

    switch (classification.risk) {
      case 'dangerous':
        return {
          behavior: 'deny',
          reason: `Blocked: ${classification.reason} — "${input.command}"`,
        }
      case 'safe_read':
        return { behavior: 'allow' }
      case 'safe_write':
        return {
          behavior: 'passthrough',
          message: `Allow running: ${input.command}`,
          suggestions: [{
            type: 'addRules',
            rules: [{ toolName: 'Bash' }],
            behavior: 'allow',
            destination: 'session',
          }],
        }
      case 'needs_confirmation':
      default:
        return {
          behavior: 'ask',
          message: `${classification.reason}: ${input.command}`,
          riskLevel: 'medium',
          suggestions: [{
            type: 'addRules',
            rules: [{ toolName: 'Bash' }],
            behavior: 'allow',
            destination: 'session',
          }],
        }
    }
  },

  interruptBehavior() {
    return 'block'
  },

  maxResultSizeChars: 100_000,

  async call(input, context): Promise<ToolResult<Output>> {
    const logger = context.logger ? context.logger as any : null
    const timeout = input.timeout || 30_000
    const startTime = Date.now()

    if (logger) {
      logger.logToolStart({
        toolName: this.name,
        input,
      })
    }

    return new Promise((resolve) => {
      const proc = spawn('bash', ['-c', input.command], {
        cwd: context.cwd,
        env: { ...process.env, TERM: 'dumb' },
        timeout,
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      const abortHandler = () => {
        proc.kill('SIGTERM')
        setTimeout(() => proc.kill('SIGKILL'), 1000)
      }
      context.abortController.signal.addEventListener('abort', abortHandler, { once: true })

      const timer = setTimeout(() => {
        timedOut = true
        proc.kill('SIGTERM')
        setTimeout(() => proc.kill('SIGKILL'), 1000)
      }, timeout)

      proc.on('close', (code) => {
        clearTimeout(timer)
        context.abortController.signal.removeEventListener('abort', abortHandler)

        const duration = Date.now() - startTime

        if (logger) {
          logger.logToolEnd({
            toolName: this.name,
            input,
            output: { exitCode: code ?? 1, timedOut },
            duration,
          })
        }

        resolve({
          data: {
            stdout: stdout.slice(0, BashTool.maxResultSizeChars),
            stderr: stderr.slice(0, 50_000),
            exitCode: code ?? 1,
            timedOut,
          },
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        context.abortController.signal.removeEventListener('abort', abortHandler)

        const duration = Date.now() - startTime

        if (logger) {
          logger.logToolError({
            toolName: this.name,
            input,
            error: err,
            duration,
          })
        }

        resolve({
          data: {
            stdout: '',
            stderr: err.message,
            exitCode: 1,
            timedOut: false,
          },
        })
      })
    })
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    let content = ''
    if (output.stdout) content += output.stdout
    if (output.stderr) content += (content ? '\n' : '') + `STDERR: ${output.stderr}`
    if (output.timedOut) content += '\n[Command timed out]'
    if (output.exitCode !== 0 && !output.timedOut) {
      content += `\n[Exit code: ${output.exitCode}]`
    }
    if (!content) content = '[No output]'

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
      is_error: output.exitCode !== 0,
    }
  },
}
