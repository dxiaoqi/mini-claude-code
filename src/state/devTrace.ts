/**
 * state/devTrace.ts — Dev Trace 记录器
 *
 * 在开发模式下（--dev flag 或 settings.devTrace: true）将完整的会话事件流
 * 以 JSONL 格式追加写入：
 *
 *   ~/.blino/projects/<hash>/<sessionId>.trace.jsonl
 *
 * 每行为一个 JSON 对象，记录内容：
 *   session_start / session_end     — 会话元数据
 *   turn_start / turn_end           — 每轮 API 调用的起止（含 token 用量与耗时）
 *   text                            — AI 文本输出（按轮聚合）
 *   tool_call                       — 工具调用（名称、输入、开始时间）
 *   tool_result                     — 工具返回（输出、耗时、是否出错）
 *   error                           — 运行时错误
 *
 * 可直接用 `jq` 分析，也可通过 eval framework 的 AgentTrace 类型进行程序化验证。
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { handleSilentError } from '../errors/handlers.js'

// ─── 事件类型 ──────────────────────────────────────────────────────────────────

export type DevTraceEvent =
  | {
      type: 'session_start'
      sessionId: string
      model: string
      cwd: string
      timestamp: string
    }
  | {
      type: 'turn_start'
      turn: number
      timestamp: string
    }
  | {
      type: 'text'
      turn: number
      text: string
    }
  | {
      type: 'tool_call'
      turn: number
      name: string
      toolUseId: string
      input: Record<string, unknown>
      startedAt: string
    }
  | {
      type: 'tool_result'
      turn: number
      name: string
      toolUseId: string
      output: unknown
      durationMs: number
      isError: boolean
    }
  | {
      type: 'turn_end'
      turn: number
      inputTokens: number
      outputTokens: number
      durationMs: number
      timestamp: string
    }
  | {
      type: 'error'
      turn: number
      message: string
      timestamp: string
    }
  | {
      type: 'session_end'
      reason: string
      totalTurns: number
      totalInputTokens: number
      totalOutputTokens: number
      timestamp: string
    }

// ─── 路径工具 ──────────────────────────────────────────────────────────────────

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function getDevTracePath(projectRoot: string, sessionId: string): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp'
  const hash = simpleHash(projectRoot)
  return resolve(homeDir, '.blino', 'projects', hash, `${sessionId}.trace.jsonl`)
}

// ─── 记录器 ────────────────────────────────────────────────────────────────────

export class DevTraceRecorder {
  private readonly filePath: string
  private initialized = false

  constructor(projectRoot: string, sessionId: string) {
    this.filePath = getDevTracePath(projectRoot, sessionId)
  }

  get path(): string {
    return this.filePath
  }

  async record(event: DevTraceEvent): Promise<void> {
    try {
      if (!this.initialized) {
        await mkdir(dirname(this.filePath), { recursive: true })
        this.initialized = true
      }
      await writeFile(this.filePath, JSON.stringify(event) + '\n', { flag: 'a' })
    } catch (err) {
      handleSilentError(err, { context: 'devTrace_write', event: event.type })
    }
  }
}
