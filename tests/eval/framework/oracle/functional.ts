/**
 * Functional Oracle — 确定性验证器
 * 执行所有非 LLM 的验证逻辑
 */

import { stat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { Validator, ValidatorResult, TestEnvironment, AgentTrace } from '../types.js'

const execAsync = promisify(exec)

export async function runValidators(
  validators: Validator[],
  env: TestEnvironment,
  trace: AgentTrace,
): Promise<Array<{ validator: Validator; result: ValidatorResult }>> {
  const results: Array<{ validator: Validator; result: ValidatorResult }> = []

  for (const v of validators) {
    const result = await runSingleValidator(v, env, trace)
    results.push({ validator: v, result })
  }

  return results
}

async function runSingleValidator(
  v: Validator,
  env: TestEnvironment,
  trace: AgentTrace,
): Promise<ValidatorResult> {
  try {
    switch (v.type) {
      case 'file_exists': {
        const path = resolve(env.cwd, v.path)
        try {
          await stat(path)
          return ok(`File exists: ${v.path}`)
        } catch {
          return fail(`File not found: ${v.path}`)
        }
      }

      case 'file_not_exists': {
        const path = resolve(env.cwd, v.path)
        try {
          await stat(path)
          return fail(`File should not exist: ${v.path}`)
        } catch {
          return ok(`File does not exist (correct): ${v.path}`)
        }
      }

      case 'file_contains': {
        const path = resolve(env.cwd, v.path)
        try {
          const content = await readFile(path, 'utf-8')
          const pattern = v.pattern instanceof RegExp ? v.pattern : new RegExp(v.pattern)
          if (pattern.test(content)) {
            return ok(`File contains pattern: ${v.path}`)
          } else {
            return fail(`File does not contain "${v.pattern}": ${v.path}`)
          }
        } catch {
          return fail(`Cannot read file: ${v.path}`)
        }
      }

      case 'file_not_contains': {
        const path = resolve(env.cwd, v.path)
        try {
          const content = await readFile(path, 'utf-8')
          const pattern = v.pattern instanceof RegExp ? v.pattern : new RegExp(v.pattern)
          if (!pattern.test(content)) {
            return ok(`File does not contain forbidden pattern: ${v.path}`)
          } else {
            return fail(`File contains forbidden pattern "${v.pattern}": ${v.path}`)
          }
        } catch {
          return fail(`Cannot read file: ${v.path}`)
        }
      }

      case 'file_line_count': {
        const path = resolve(env.cwd, v.path)
        const content = await readFile(path, 'utf-8')
        const lines = content.split('\n').length
        if (v.min !== undefined && lines < v.min) {
          return fail(`File too short: ${lines} lines (min: ${v.min})`)
        }
        if (v.max !== undefined && lines > v.max) {
          return fail(`File too long: ${lines} lines (max: ${v.max})`)
        }
        return ok(`File has ${lines} lines`)
      }

      case 'command_success': {
        try {
          await execAsync(v.command, { cwd: env.cwd, timeout: 60_000 })
          return ok(`Command succeeded: ${v.command}`)
        } catch (err) {
          const msg = (err as { stderr?: string; stdout?: string }).stderr ||
            (err as { stdout?: string }).stdout || String(err)
          return fail(`Command failed: ${v.command}\n${msg.slice(0, 500)}`)
        }
      }

      case 'command_output_contains': {
        try {
          const { stdout, stderr } = await execAsync(v.command, { cwd: env.cwd, timeout: 60_000 })
          const combined = stdout + stderr
          if (combined.includes(v.contains)) {
            return ok(`Command output contains "${v.contains}"`)
          } else {
            return fail(`Command output does not contain "${v.contains}"\nOutput: ${combined.slice(0, 300)}`)
          }
        } catch (err) {
          return fail(`Command failed: ${v.command}: ${err}`)
        }
      }

      case 'command_exit_code': {
        try {
          await execAsync(v.command, { cwd: env.cwd, timeout: 60_000 })
          if (v.code === 0) return ok(`Command exited with 0`)
          return fail(`Command succeeded (exit 0) but expected ${v.code}`)
        } catch (err) {
          const exitCode = (err as { code?: number }).code
          if (exitCode === v.code) return ok(`Command exited with expected code ${v.code}`)
          return fail(`Command exited with ${exitCode}, expected ${v.code}`)
        }
      }

      case 'tool_called': {
        const calls = trace.toolCalls.filter(t => t.name === v.toolName)
        const count = calls.length
        if (v.minTimes !== undefined && count < v.minTimes) {
          return fail(`${v.toolName} called ${count} times (min: ${v.minTimes})`)
        }
        if (v.maxTimes !== undefined && count > v.maxTimes) {
          return fail(`${v.toolName} called ${count} times (max: ${v.maxTimes})`)
        }
        if (count === 0 && !v.minTimes) {
          return fail(`${v.toolName} was never called`)
        }
        return ok(`${v.toolName} called ${count} time(s)`)
      }

      case 'tool_not_called': {
        const calls = trace.toolCalls.filter(t => t.name === v.toolName)
        if (calls.length > 0) {
          return fail(`${v.toolName} was called ${calls.length} times (should not be called)`)
        }
        return ok(`${v.toolName} was not called (correct)`)
      }

      case 'asked_clarification': {
        const hasAskUser = trace.toolCalls.some(t => t.name === 'AskUser')
        const hasQuestion = trace.messages.some(m =>
          m.role === 'assistant' && m.content.includes('?') &&
          !m.hasToolUse
        )
        if (hasAskUser || hasQuestion) {
          return ok('Agent asked for clarification')
        }
        return fail('Agent did not ask for clarification on ambiguous input')
      }

      case 'verified_result': {
        const verificationCommands = ['npm test', 'npx tsc', 'vitest', 'jest', 'pytest']
        const hasVerification = trace.toolCalls.some(t =>
          t.name === 'Bash' &&
          verificationCommands.some(cmd =>
            (t.input['command'] as string || '').includes(cmd)
          )
        )
        if (hasVerification) {
          return ok('Agent verified results by running tests/compilation')
        }
        return { passed: false, score: 0, message: 'Agent did not run tests or compilation to verify results' }
      }

      case 'used_planning': {
        const hasTodoWrite = trace.toolCalls.some(t => t.name === 'TodoWrite')
        if (hasTodoWrite) {
          return ok('Agent used TodoWrite for planning')
        }
        // Partial credit if agent used multi-step approach
        if (trace.turnCount > 3 && trace.toolCalls.length > 5) {
          return { passed: true, score: 0.5, message: 'Agent used multi-step approach (no TodoWrite)' }
        }
        return fail('Agent did not use TodoWrite for task planning')
      }

      case 'agent_spawned': {
        const spawned = trace.agentSpawns
        const min = v.minAgents ?? 1
        if (spawned >= min) {
          return ok(`${spawned} sub-agent(s) spawned (min: ${min})`)
        }
        return fail(`Only ${spawned} sub-agent(s) spawned (min: ${min})`)
      }

      case 'llm_judge': {
        // Handled separately in metrics.ts
        return ok('LLM Judge pending evaluation')
      }

      case 'custom': {
        return v.fn(env, trace)
      }

      default:
        return fail(`Unknown validator type: ${(v as Validator).type}`)
    }
  } catch (err) {
    return fail(`Validator error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function ok(message: string): ValidatorResult {
  return { passed: true, score: 1, message }
}

function fail(message: string): ValidatorResult {
  return { passed: false, score: 0, message }
}
