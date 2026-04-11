/**
 * utils/hooks.ts — 外部 Hooks 系统
 *
 * 在工具调用前后执行用户配置的外部脚本，支持：
 *   - PreToolUse:  工具调用前执行，可修改 input 或拒绝调用
 *   - PostToolUse: 工具调用后执行，可记录/通知
 *   - Stop:        Agent 完成时执行，可阻止继续（返回 preventContinuation）
 *
 * 配置在 settings.json 的 hooks 字段：
 * {
 *   "hooks": {
 *     "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo $TOOL_INPUT" }] }],
 *     "PostToolUse": [...],
 *     "Stop": [{ "hooks": [{ "type": "command", "command": "notify-send 'Done'" }] }]
 *   }
 * }
 */

import { execFile } from 'node:child_process'
import type { Tool } from '../types.js'

export interface HookConfig {
  type: 'command'
  command: string
  timeout?: number
}

export interface HookMatcher {
  matcher?: string   // 工具名匹配（支持 * 通配符），为空则匹配所有
  hooks: HookConfig[]
}

export interface HooksSettings {
  PreToolUse?: HookMatcher[]
  PostToolUse?: HookMatcher[]
  Stop?: HookMatcher[]
}

export interface HookResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface PreToolUseHookResult extends HookResult {
  /** 非 null 时：覆盖原始 input */
  updatedInput?: Record<string, unknown>
  /** true 时：拒绝工具调用 */
  preventExecution?: boolean
  /** 拒绝原因 */
  reason?: string
}

export interface StopHookResult extends HookResult {
  /** true 时：阻止 Agent 退出（注入阻塞消息让 AI 修正） */
  preventContinuation?: boolean
  /** 注入给 AI 的阻塞消息 */
  blockingMessage?: string
}

/**
 * 执行 PreToolUse hooks
 */
export async function runPreToolUseHooks(
  hooksSettings: HooksSettings | undefined,
  tool: Tool,
  input: Record<string, unknown>,
  cwd: string,
): Promise<PreToolUseHookResult | null> {
  const matchers = hooksSettings?.PreToolUse
  if (!matchers || matchers.length === 0) return null

  for (const matcher of matchers) {
    if (!matchesTool(matcher.matcher, tool.name)) continue

    for (const hook of matcher.hooks) {
      const env = {
        ...process.env,
        TOOL_NAME: tool.name,
        TOOL_INPUT: JSON.stringify(input),
      }
      const result = await runCommand(hook.command, cwd, env, hook.timeout)

      // hook 返回非 0 → 拒绝调用
      if (result.exitCode !== 0) {
        return {
          ...result,
          preventExecution: true,
          reason: result.stderr || result.stdout || `Hook exited with code ${result.exitCode}`,
        }
      }

      // hook stdout 是 JSON → 尝试解析为 updatedInput
      if (result.stdout.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(result.stdout.trim())
          if (parsed && typeof parsed === 'object') {
            return { ...result, updatedInput: parsed }
          }
        } catch { /* not JSON */ }
      }
    }
  }

  return null
}

/**
 * 执行 PostToolUse hooks
 */
export async function runPostToolUseHooks(
  hooksSettings: HooksSettings | undefined,
  tool: Tool,
  input: Record<string, unknown>,
  output: string,
  cwd: string,
): Promise<void> {
  const matchers = hooksSettings?.PostToolUse
  if (!matchers || matchers.length === 0) return

  for (const matcher of matchers) {
    if (!matchesTool(matcher.matcher, tool.name)) continue

    for (const hook of matcher.hooks) {
      const env = {
        ...process.env,
        TOOL_NAME: tool.name,
        TOOL_INPUT: JSON.stringify(input),
        TOOL_OUTPUT: output.slice(0, 10_000),
      }
      await runCommand(hook.command, cwd, env, hook.timeout).catch(() => {})
    }
  }
}

/**
 * 执行 Stop hooks（Agent 完成时）
 */
export async function runStopHooks(
  hooksSettings: HooksSettings | undefined,
  sessionId: string,
  turnCount: number,
  cwd: string,
): Promise<StopHookResult | null> {
  const matchers = hooksSettings?.Stop
  if (!matchers || matchers.length === 0) return null

  for (const matcher of matchers) {
    for (const hook of matcher.hooks) {
      const env = {
        ...process.env,
        SESSION_ID: sessionId,
        TURN_COUNT: String(turnCount),
      }
      const result = await runCommand(hook.command, cwd, env, hook.timeout)

      if (result.exitCode !== 0) {
        const message = result.stderr || result.stdout || `Stop hook blocked continuation (exit ${result.exitCode})`
        return { ...result, preventContinuation: true, blockingMessage: message }
      }
    }
  }

  return null
}

function matchesTool(matcher: string | undefined, toolName: string): boolean {
  if (!matcher || matcher === '*') return true
  if (matcher === toolName) return true
  if (matcher.endsWith('*')) return toolName.startsWith(matcher.slice(0, -1))
  return false
}

function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string | undefined>,
  timeout = 10_000,
): Promise<HookResult> {
  return new Promise((resolve) => {
    execFile('sh', ['-c', command], { cwd, env: env as NodeJS.ProcessEnv, timeout }, (err, stdout, stderr) => {
      resolve({
        exitCode: (err as NodeJS.ErrnoException & { code?: number })?.code ?? 0,
        stdout: stdout || '',
        stderr: stderr || '',
      })
    })
  })
}
