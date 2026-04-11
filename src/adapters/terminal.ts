/**
 * adapters/terminal.ts — 终端 REPL 适配器
 *
 * 实现 UIAdapter：彩色流式输出、工具权限询问与行编辑用户输入。
 */
import * as readline from 'node:readline'
import chalk from 'chalk'
import type {
  PermissionRequest,
  PermissionResponse,
  StreamEvent,
  ToolResult,
  UIAdapter,
} from '../types.js'

export class TerminalAdapter implements UIAdapter {
  private rl: readline.Interface | null = null
  private currentText = ''

  onStreamEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'text_delta':
        process.stdout.write(event.text)
        this.currentText += event.text
        break

      case 'thinking_delta':
        process.stdout.write(chalk.dim(event.thinking))
        break

      case 'message_start':
        this.currentText = ''
        break

      case 'message_end':
        if (this.currentText) {
          process.stdout.write('\n')
          this.currentText = ''
        }
        break

      case 'turn_complete':
        break

      case 'session_complete':
        console.log(chalk.dim(`\n[Session complete: ${event.reason}]`))
        break
    }
  }

  onToolStart(toolName: string, input: Record<string, unknown>): void {
    const summary = this.getToolSummary(toolName, input)
    console.log(chalk.cyan(`\n⏳ ${toolName}: ${summary}`))
  }

  onToolEnd(toolName: string, result: ToolResult): void {
    const data = result.data as Record<string, unknown>
    const isError = data?.is_error || data?.success === false
    if (isError) {
      console.log(chalk.red(`✗ ${toolName} failed`))
    } else {
      console.log(chalk.green(`✓ ${toolName} completed`))
    }
  }

  onError(error: Error): void {
    console.error(chalk.red(`\nError: ${error.message}`))
  }

  async *getUserInput(): AsyncGenerator<string> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    let closed = false
    this.rl.once('close', () => { closed = true })

    while (!closed) {
      const input = await new Promise<string | null>((resolve) => {
        if (closed) { resolve(null); return }
        try {
          this.rl!.question(chalk.bold.blue('\n> '), (answer) => {
            resolve(answer)
          })
        } catch {
          resolve(null)
        }
      })

      if (input === null) break
      const trimmed = input.trim()
      if (!trimmed) continue
      if (trimmed === '/exit' || trimmed === '/quit') break
      yield trimmed
    }
  }

  async requestPermission(request: PermissionRequest): Promise<PermissionResponse> {
    const { tool, input } = request
    const summary = this.getToolSummary(tool.name, input)

    console.log(chalk.yellow(`\n🔒 Permission required: ${tool.name}`))
    console.log(chalk.yellow(`   ${summary}`))

    if (request.permissionResult.behavior === 'ask' && 'message' in request.permissionResult) {
      console.log(chalk.dim(`   ${request.permissionResult.message}`))
    }

    return new Promise<PermissionResponse>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      rl.question(
        chalk.yellow('   [y]es / [n]o / [a]lways allow: '),
        (answer) => {
          rl.close()
          const a = answer.trim().toLowerCase()
          if (a === 'y' || a === 'yes') {
            resolve({ decision: 'allow' })
          } else if (a === 'a' || a === 'always') {
            resolve({ decision: 'allow_always' })
          } else {
            resolve({ decision: 'deny' })
          }
        },
      )
    })
  }

  async destroy(): Promise<void> {
    this.rl?.close()
  }

  private getToolSummary(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case 'Bash':
        return String(input.command || '').slice(0, 100)
      case 'FileRead':
        return String(input.file_path || '')
      case 'FileEdit':
        return `${input.file_path}`
      case 'FileWrite':
        return `${input.file_path}`
      default:
        return JSON.stringify(input).slice(0, 80)
    }
  }
}
