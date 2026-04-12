/**
 * server/index.ts — HTTP Server 主入口
 *
 * 将 mini-claude-code 暴露为 HTTP 服务，供 Next.js 前端调用。
 * 每个 session 持有独立的 AgentEngine 实例和 SSEAdapter。
 *
 * API 路由：
 *   GET  /api/health                         — 健康检查
 *   POST /api/sessions                       — 创建 session
 *   GET  /api/sessions                       — 列出 sessions
 *   GET  /api/sessions/:id                   — 获取 session 状态
 *   DELETE /api/sessions/:id                 — 关闭/清空 session
 *   POST /api/sessions/:id/chat              — 发消息（SSE 流式返回）
 *   POST /api/sessions/:id/compact           — 手动压缩
 *   POST /api/permission/:requestId/respond  — 权限弹窗回调
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, join } from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import { HttpServerAdapter } from '../adapters/http.js'
import { createSessionState } from '../state/SessionState.js'
import { runAgentLoop } from '../engine/AgentEngine.js'
import { apiCompact } from '../compact/apiCompact.js'
import { listSessions, loadTranscript } from '../state/transcript.js'
import { loadSettings, getLocalConfigPath } from '../utils/config.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  APIClient,
  CanUseToolFn,
  ContextProvider,
  PermissionResponse,
  SessionState,
  Tool,
} from '../types.js'

interface SessionEntry {
  id: string
  state: SessionState
  adapter: HttpServerAdapter
  tools: Tool[]
  apiClient: APIClient
  contextProviders: ContextProvider[]
  mcpManager?: { getAllConnections(): unknown[] }
  createdAt: Date
  lastActiveAt: Date
}

export interface ServerConfig {
  port: number
  host: string
  apiClient: APIClient
  tools: Tool[]
  contextProviders: ContextProvider[]
  mcpManager?: { getAllConnections(): unknown[] }
  cwd: string
  corsOrigin?: string
  /** 默认模型名（从 CLI --model 传入） */
  defaultModel: string
  /** Next.js 静态导出目录（--tui 时提供，用于内嵌 Web UI） */
  webDistPath?: string
}

export function createMiniClaudeServer(config: ServerConfig) {
  const sessions = new Map<string, SessionEntry>()

  // ── 工具函数 ──

  function cors(res: ServerResponse, origin: string): void {
    const allowed = config.corsOrigin || '*'
    res.setHeader('Access-Control-Allow-Origin', allowed)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }

  function json(res: ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  function notFound(res: ServerResponse): void {
    json(res, { error: 'Not found' }, 404)
  }

  async function readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {})
        } catch {
          resolve({})
        }
      })
      req.on('error', reject)
    })
  }

  function getOrCreateSession(sessionId?: string): SessionEntry {
    if (sessionId && sessions.has(sessionId)) {
      const s = sessions.get(sessionId)!
      s.lastActiveAt = new Date()
      return s
    }

    const id = sessionId || uuidv4()
    const state = createSessionState({
      cwd: config.cwd,
      settings: { model: config.defaultModel },
    })
    const adapter = new HttpServerAdapter()

    const entry: SessionEntry = {
      id,
      state,
      adapter,
      tools: config.tools,
      apiClient: config.apiClient,
      contextProviders: config.contextProviders,
      mcpManager: config.mcpManager,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    }
    sessions.set(id, entry)
    return entry
  }

  function sessionToInfo(entry: SessionEntry) {
    return {
      id: entry.id,
      messageCount: entry.state.messages.length,
      model: entry.state.model,
      totalInputTokens: entry.state.totalInputTokens,
      totalOutputTokens: entry.state.totalOutputTokens,
      totalCostUSD: entry.state.totalCostUSD,
      permissionMode: entry.state.permissionMode,
      createdAt: entry.createdAt.toISOString(),
      lastActiveAt: entry.lastActiveAt.toISOString(),
    }
  }

  // ── HTTP 路由处理 ──

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const path = url.pathname
    const method = req.method?.toUpperCase() || 'GET'
    const origin = req.headers.origin || ''

    cors(res, origin)

    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // ── GET /api/config ──
    if (method === 'GET' && path === '/api/config') {
      try {
        const settings = await loadSettings(config.cwd)
        // 返回 workspace 可编辑的字段（不返回 API key 明文，只返回是否已设置）
        json(res, {
          model: settings.api?.model || config.defaultModel,
          fallbackModel: settings.fallbackModel,
          permissionMode: settings.permissionMode || 'default',
          devTrace: settings.devTrace || false,
          api: {
            provider: settings.api?.provider,
            anthropicBaseUrl: settings.api?.anthropicBaseUrl,
            openaiBaseUrl: settings.api?.openaiBaseUrl,
            hasAnthropicKey: !!(settings.api?.anthropicApiKey),
            hasOpenaiKey: !!(settings.api?.openaiApiKey),
          },
        })
      } catch {
        json(res, {})
      }
      return
    }

    // ── PUT /api/config ──
    if (method === 'PUT' && path === '/api/config') {
      try {
        const body = await readBody(req) as Record<string, unknown>
        const localConfigPath = getLocalConfigPath(config.cwd)

        // 读取现有 local config
        let existing: Record<string, unknown> = {}
        try {
          const { readFile } = await import('node:fs/promises')
          existing = JSON.parse(await readFile(localConfigPath, 'utf-8'))
        } catch { /* first time */ }

        // 合并：只更新允许的字段
        if (body.permissionMode) existing.permissionMode = body.permissionMode
        if (body.devTrace !== undefined) existing.devTrace = body.devTrace
        if (body.fallbackModel !== undefined) existing.fallbackModel = body.fallbackModel

        // api 子对象
        if (body.api && typeof body.api === 'object') {
          const apiUpdate = body.api as Record<string, unknown>
          const existingApi = (existing.api as Record<string, unknown>) || {}
          if (apiUpdate.model !== undefined) existingApi.model = apiUpdate.model
          if (apiUpdate.provider !== undefined) existingApi.provider = apiUpdate.provider
          if (apiUpdate.anthropicBaseUrl !== undefined) existingApi.anthropicBaseUrl = apiUpdate.anthropicBaseUrl
          if (apiUpdate.openaiBaseUrl !== undefined) existingApi.openaiBaseUrl = apiUpdate.openaiBaseUrl
          // API keys: only write if non-empty string
          if (typeof apiUpdate.anthropicApiKey === 'string' && apiUpdate.anthropicApiKey.length > 0) {
            existingApi.anthropicApiKey = apiUpdate.anthropicApiKey
          }
          if (typeof apiUpdate.openaiApiKey === 'string' && apiUpdate.openaiApiKey.length > 0) {
            existingApi.openaiApiKey = apiUpdate.openaiApiKey
          }
          existing.api = existingApi
        }

        await mkdir(dirname(localConfigPath), { recursive: true })
        await writeFile(localConfigPath, JSON.stringify(existing, null, 2), 'utf-8')

        // 更新活跃 session 的 model
        if (body.api && typeof (body.api as Record<string, unknown>).model === 'string') {
          const newModel = (body.api as Record<string, unknown>).model as string
          for (const entry of sessions.values()) {
            entry.state.model = newModel
          }
        }

        json(res, { ok: true })
      } catch (err) {
        json(res, { ok: false, error: (err as Error).message }, 500)
      }
      return
    }

    // ── GET /api/health ──
    if (method === 'GET' && path === '/api/health') {
      json(res, {
        status: 'ok',
        activeSessions: sessions.size,
        defaultModel: config.defaultModel,
        version: '0.1.0',
      })
      return
    }

    // ── POST /api/sessions ──
    if (method === 'POST' && path === '/api/sessions') {
      const body = await readBody(req) as { sessionId?: string; model?: string; resumeSessionId?: string }

      let entry: SessionEntry

      // 恢复历史 session
      if (body.resumeSessionId) {
        entry = getOrCreateSession(body.resumeSessionId)
        if (entry.state.messages.length === 0) {
          const messages = await loadTranscript(config.cwd, body.resumeSessionId).catch(() => [])
          if (messages.length > 0) {
            entry.state.messages = messages
            entry.state.sessionId = body.resumeSessionId
          }
        }
      } else {
        entry = getOrCreateSession(body.sessionId)
      }

      if (body.model) {
        entry.state.model = body.model
      }

      json(res, { session: sessionToInfo(entry) })
      return
    }

    // ── GET /api/sessions ──
    if (method === 'GET' && path === '/api/sessions') {
      const active = [...sessions.values()].map(sessionToInfo)
      const history = await listSessions(config.cwd).catch(() => [] as { sessionId: string; modifiedAt: Date }[])
      json(res, { active, history: history.slice(0, 20) })
      return
    }

    // ── GET /api/sessions/:id ──
    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/)
    if (method === 'GET' && sessionMatch) {
      const entry = sessions.get(sessionMatch[1])
      if (!entry) return json(res, { error: 'Session not found' }, 404)
      json(res, { session: sessionToInfo(entry), messages: entry.state.messages })
      return
    }

    // ── DELETE /api/sessions/:id ──
    if (method === 'DELETE' && sessionMatch) {
      const entry = sessions.get(sessionMatch[1])
      if (!entry) return json(res, { error: 'Session not found' }, 404)
      entry.adapter.endSession(entry.id)
      sessions.delete(entry.id)
      json(res, { ok: true })
      return
    }

    // ── POST /api/sessions/:id/compact ──
    const compactMatch = path.match(/^\/api\/sessions\/([^/]+)\/compact$/)
    if (method === 'POST' && compactMatch) {
      const entry = sessions.get(compactMatch[1])
      if (!entry) return json(res, { error: 'Session not found' }, 404)

      const result = await apiCompact({
        messages: entry.state.messages,
        apiClient: entry.apiClient,
        model: entry.state.model,
      }).catch(() => null)

      if (result) {
        entry.state.messages = result.messages
        entry.state.systemPromptSectionCache.clear()
        json(res, {
          ok: true,
          preTokens: result.preCompactTokenCount,
          postTokens: result.postCompactTokenCount,
        })
      } else {
        json(res, { ok: false, error: 'Compact failed' }, 500)
      }
      return
    }

    // ── POST /api/sessions/:id/chat  (SSE) ──
    const chatMatch = path.match(/^\/api\/sessions\/([^/]+)\/chat$/)
    if (method === 'POST' && chatMatch) {
      const sessionId = chatMatch[1]
      const body = await readBody(req) as {
        message: string
        model?: string
        bypassPermissions?: boolean
      }

      if (!body.message?.trim()) {
        return json(res, { error: 'message is required' }, 400)
      }

      const entry = getOrCreateSession(sessionId)

      if (body.model) entry.state.model = body.model
      if (body.bypassPermissions) entry.state.permissionMode = 'bypass'

      // 设置 SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      // 注册 SSE 连接
      const abortController = new AbortController()
      entry.adapter.registerConnection(sessionId, res, abortController)

      // 客户端断开时 abort
      req.on('close', () => {
        abortController.abort()
        entry.adapter.endSession(sessionId)
      })

      // 创建 session 专属 adapter（精确推流到此连接）
      const sessionAdapter = createSessionAdapter(entry.adapter, sessionId)

      try {
        await runAgentLoop(
          entry.state,
          {
            apiClient: entry.apiClient,
            tools: entry.tools,
            adapter: sessionAdapter,
            contextProviders: entry.contextProviders,
            mcpManager: entry.mcpManager,
          },
          body.message,
        )
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        // 直接写 SSE，避免 Error 对象 JSON 序列化为空 {}
        if (!res.writableEnded) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: errMsg })}\n\n`)
        }
        console.error('[chat error]', errMsg)
      } finally {
        entry.lastActiveAt = new Date()
        if (!res.writableEnded) {
          res.write(`event: done\ndata: {"sessionId":"${sessionId}"}\n\n`)
          res.end()
        }
      }
      return
    }

    // ── POST /api/permission/:requestId/respond ──
    const permMatch = path.match(/^\/api\/permission\/([^/]+)\/respond$/)
    if (method === 'POST' && permMatch) {
      const requestId = permMatch[1]
      const body = await readBody(req) as { decision: 'allow' | 'allow_always' | 'deny' }

      const response: PermissionResponse = { decision: body.decision || 'deny' }

      // 找到持有该 pending permission 的 session
      let resolved = false
      for (const entry of sessions.values()) {
        if (entry.adapter.resolvePermission(requestId, response)) {
          resolved = true
          break
        }
      }

      json(res, { ok: resolved })
      return
    }

    // ── Static files (web UI from Next.js static export) ──
    if (config.webDistPath) {
      await serveStatic(config.webDistPath, path, res)
      return
    }

    notFound(res)
  })

  return {
    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          console.log(`\n🌐 mini-claude-code server running at http://${config.host}:${config.port}`)
          resolve()
        })
      })
    },
    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve())
      })
    },
    getSessions: () => sessions,
    server,
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

async function serveStatic(distPath: string, urlPath: string, res: ServerResponse): Promise<void> {
  // Map URL path to file path
  let filePath = join(distPath, urlPath === '/' ? 'index.html' : urlPath)

  // Handle Next.js static export: try exact path, then .html, then index.html
  const attempts = [filePath, filePath + '.html', join(filePath, 'index.html')]

  for (const attempt of attempts) {
    try {
      const s = await stat(attempt)
      if (s.isFile()) {
        const content = await readFile(attempt)
        const mime = MIME_TYPES[extname(attempt).toLowerCase()] || 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' })
        res.end(content)
        return
      }
    } catch { /* continue */ }
  }

  // 404 → serve index.html for SPA routing
  try {
    const indexPath = join(distPath, 'index.html')
    const content = await readFile(indexPath)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}

/**
 * 创建专属于某个 session 的 adapter 包装器
 * 保证 SSE 事件只推到对应连接
 *
 * 注意：onToolStart / onToolEnd 设为 no-op
 * 原因：AgentEngine 会同时调用 onStreamEvent（包含完整 tool_use_start / tool_result 事件）
 * 和 onToolStart / onToolEnd，若 onToolStart 再次发送 tool_use_start 会导致
 * 前端为同一工具调用产生两张卡片（一张 Done，一张永远 Running）。
 */
function createSessionAdapter(
  httpAdapter: HttpServerAdapter,
  sessionId: string,
): import('../types.js').UIAdapter {
  return {
    onStreamEvent(event) {
      httpAdapter.sendToSession(sessionId, event)
    },
    // no-op：tool_use_start 已通过 onStreamEvent 转发（含真实 id）
    onToolStart(_toolName, _input) {},
    // no-op：tool_result 已通过 onStreamEvent 转发（含真实 toolUseId）
    onToolEnd(_toolName, _result) {},
    onError(error) {
      // 直接写 SSE 原始帧，避免 Error 对象 JSON 序列化为空 {}
      const conn = (httpAdapter as unknown as { connections: Map<string, { res: import('node:http').ServerResponse }> }).connections.get(sessionId)
      if (conn && !conn.res.writableEnded) {
        conn.res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`)
      }
    },
    async *getUserInput() { /* not used in server mode */ },
    requestPermission(request) {
      return httpAdapter.requestPermission(request)
    },
  }
}
