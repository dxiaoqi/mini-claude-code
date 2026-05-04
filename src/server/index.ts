/**
 * server/index.ts — HTTP Server 主入口
 *
 * 将 /blino 暴露为 HTTP 服务，供 Next.js 前端调用。
 * 每个 session 持有独立的 AgentEngine 实例和 SSEAdapter。
 *
 * API 路由：
 *   GET  /api/health                         — 健康检查
 *   POST /api/sessions                       — 创建 session
 *   GET  /api/sessions                       — 列出 sessions
 *   GET  /api/sessions/:id                   — 获取 session 状态
 *   DELETE /api/sessions/:id                 — 关闭/清空 session
 *   POST /api/sessions/:id/chat              — 发消息（SSE 流式返回）
 *   POST /api/sessions/:id/ui-message         — 从 UI 追加单条 user/assistant（写入 state + transcript）
 *   POST /api/sessions/:id/compact           — 手动压缩
 *   POST /api/permission/:requestId/respond  — 权限弹窗回调
 *   GET  /workflow/list                       — 工作流列表
 *   GET  /workflow/detail/:workflowId         — 单个工作流完整元数据（nodeIds / nodes）
 *   POST /workflow/run                        — 启动工作流
 *   GET  /workflow/events/:runId            — 工作流 SSE
 *   POST /workflow/resume/:runId              — HIL 审批
 *   GET  /workflow/snapshot/:runId            — 运行快照 JSON
 *   GET  /workflow/list-running               — 当前运行中的 runId 列表
 *   GET  /user-tools/list                     — 当前加载的用户自定义工具
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, join } from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import { HttpServerAdapter } from '../adapters/http.js'
import { addMessage, createSessionState } from '../state/SessionState.js'
import { BLINO_PROJECT_SUB, resolveProjectBlinoPath } from '../constants/blinoPaths.js'
import { UserToolLoader } from '../tools/user/UserToolLoader.js'
import { mergeTools } from '../tools/user/mergeTools.js'
import { createToolSearchTool } from '../tools/ToolSearchTool.js'
import { runAgentLoop } from '../engine/AgentEngine.js'
import { apiCompact } from '../compact/apiCompact.js'
import { listSessions, loadTranscript, recordTranscript } from '../state/transcript.js'
import { loadSettings, getLocalConfigPath, resolveApiConfig } from '../utils/config.js'
import { rebuildApiClientFromWorkspace } from './rebuildApiClient.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { eventBus } from '../events/EventBus.js'
import { loadWorkflowRegistry } from '../workflow/WorkflowRegistry.js'
import { runDagWorkflow } from '../workflow/DAGEngine.js'
import { topologicalOrder } from '../workflow/topo.js'
import { getWorkflowSnapshotFilePathForRun } from '../workflow/snapshotFile.js'
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

/** Loopback clients only (Node SSR / curl). Browsers send Origin on cross-port fetches. */
function isLoopbackRemote(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}

function browserSentOrigin(req: IncomingMessage): boolean {
  const o = req.headers.origin
  return typeof o === 'string' && o.length > 0
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

export async function createBlinoServer(config: ServerConfig) {
  const sessions = new Map<string, SessionEntry>()
  /** 并发工作流：runId -> workflowId，完成或异常时在 finally 中 delete */
  const runningWorkflows = new Map<string, string>()
  /** Replaced after PUT /api/config so new API keys apply without restart */
  let liveApiClient: APIClient = config.apiClient

/** Tool names that write to the filesystem — blocked in artifacts mode */
const WRITE_TOOL_NAMES = new Set([
  'FileWrite', 'FileEdit', 'Bash', 'NotebookEdit',
  'TodoWrite', 'SkillCreator',
])

  function buildSessionTools(userToolsList: Tool[], artifactsMode = false): Tool[] {
    const source = config.tools.filter(t => t.name !== 'ToolSearch' && t.name !== 'Agent')
    let baseMerged = mergeTools(source, userToolsList)
    if (artifactsMode) {
      baseMerged = baseMerged.filter(t => !WRITE_TOOL_NAMES.has(t.name))
    }
    const toolSearch = createToolSearchTool(baseMerged)
    const agent = config.tools.find(t => t.name === 'Agent')
    if (!agent) return [...baseMerged, toolSearch]
    return [...baseMerged, toolSearch, agent]
  }

  const userToolsDir = resolveProjectBlinoPath(config.cwd, BLINO_PROJECT_SUB.tools)
  const userToolLoader = new UserToolLoader(userToolsDir)
  userToolLoader.onChange(() => {
    const userTools = userToolLoader.getTools()
    for (const entry of sessions.values()) {
      const isArtifacts = !!entry.state.settings.systemPromptAddendum
      entry.tools = buildSessionTools(userTools, isArtifacts)
    }
    console.log(
      `[UserToolLoader] 工具已热更新，当前用户工具：${userTools.map(t => t.name).join(', ') || '无'}`,
    )
  })
  await userToolLoader.start()

  // ── 工具函数 ──

  /** 本地 Web UI 常见 Origin（与 localhost 不等价，浏览器 CORS 需逐字一致） */
  const LOOPBACK_DEV_UI =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(:(3000|3002|5173|4173|8080))?(?:\/)?$/i

  function pickAllowOrigin(requestOrigin: string): string {
    const o = (requestOrigin || '').trim()
    if (!o) {
      return config.corsOrigin || '*'
    }
    if (config.corsOrigin && (o === config.corsOrigin || o.startsWith(config.corsOrigin + '/'))) {
      return o
    }
    if (LOOPBACK_DEV_UI.test(o)) {
      return o
    }
    return config.corsOrigin || '*'
  }

  function cors(res: ServerResponse, origin: string): void {
    const allowed = pickAllowOrigin(origin)
    res.setHeader('Access-Control-Allow-Origin', allowed)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    // credentials 时 ACAO 不能是 *，须与请求 Origin 一致
    if (allowed === '*') {
      res.setHeader('Access-Control-Allow-Credentials', 'false')
    } else {
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }
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
      tools: buildSessionTools(userToolLoader.getTools()),
      apiClient: liveApiClient,
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
    const path =
      url.pathname.length > 1 && url.pathname.endsWith('/')
        ? url.pathname.replace(/\/+$/, '')
        : url.pathname
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
        const topModel = settings.api?.model || settings.model || config.defaultModel
        const includeSecrets =
          url.searchParams.get('secrets') === '1' &&
          isLoopbackRemote(req) &&
          !browserSentOrigin(req)

        const basePayload = {
          model: topModel,
          fallbackModel: settings.fallbackModel ?? settings.api?.fallbackModel,
          permissionMode: settings.permissionMode || 'default',
          devTrace: settings.devTrace || false,
          api: {
            provider: settings.api?.provider,
            model: settings.api?.model || topModel,
            anthropicBaseUrl: settings.api?.anthropicBaseUrl,
            openaiBaseUrl: settings.api?.openaiBaseUrl,
            hasAnthropicKey: !!(settings.api?.anthropicApiKey),
            hasOpenaiKey: !!(settings.api?.openaiApiKey),
          },
        }

        // Node/SSR only: effective keys for Artifacts orchestrator (OpenAI SDK on Next server).
        if (includeSecrets) {
          const r = await resolveApiConfig(config.cwd)
          json(res, {
            ...basePayload,
            model: r.model,
            api: {
              ...basePayload.api,
              provider: r.provider,
              model: r.model,
              anthropicBaseUrl:
                r.provider === 'anthropic' ? r.baseUrl : basePayload.api.anthropicBaseUrl,
              openaiBaseUrl: r.provider === 'openai' ? r.baseUrl : basePayload.api.openaiBaseUrl,
              anthropicApiKey: r.provider === 'anthropic' ? r.apiKey : '',
              openaiApiKey: r.provider === 'openai' ? r.apiKey : '',
              hasAnthropicKey: r.provider === 'anthropic' ? !!r.apiKey : basePayload.api.hasAnthropicKey,
              hasOpenaiKey: r.provider === 'openai' ? !!r.apiKey : basePayload.api.hasOpenaiKey,
            },
          })
          return
        }

        json(res, basePayload)
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

        try {
          const nextClient = await rebuildApiClientFromWorkspace(config.cwd)
          liveApiClient = nextClient
          for (const entry of sessions.values()) {
            entry.apiClient = nextClient
          }
        } catch (err) {
          console.warn('[PUT /api/config] rebuild API client failed:', (err as Error).message)
        }

        json(res, { ok: true })
      } catch (err) {
        json(res, { ok: false, error: (err as Error).message }, 500)
      }
      return
    }

    // ── GET /api/visual-context  (visual protocol for Artifacts mode) ──
    if (method === 'GET' && path === '/api/visual-context') {
      try {
        const { readFileSync } = await import('node:fs')
        const { resolve: rp } = await import('node:path')
        const { fileURLToPath: fu } = await import('node:url')
        // Resolve skill-pack relative to this file (works in both dev and prod)
        // dev:  src/server/index.ts  → ../../ui/skill-pack
        // prod: dist/server/index.js → ../../ui/skill-pack
        const fileDir = rp(fu(import.meta.url), '..')
        const skillRoot = rp(fileDir, '..', '..', 'ui', 'skill-pack')

        const read = (name: string) => {
          try { return readFileSync(rp(skillRoot, name), 'utf-8') } catch { return '' }
        }

        const skillMd = read('SKILL.md')
        const visualProtocol = read('visual-protocol.md')
        const rulesDoc = read('rules.md')

        if (!visualProtocol) {
          json(res, { content: null }, 404)
          return
        }

        const overrideRules = `\
## ⚠️ ARTIFACTS MODE — VISUAL GENERATION OVERRIDE RULES (HIGHEST PRIORITY)

1. **NEVER use Bash, ShellTool, or any tool to install graphviz, dot, plantuml, or any diagram software.**
2. **NEVER use FileWrite or any file tool to write content — not diagrams, not HTML, not any output. ALL content must be output inline using the visual protocol tags below.**
3. **When the user asks for a diagram, chart, interactive UI, or any visual: ALWAYS generate it inline using \`<visual type="svg">\`, \`<visual type="html">\`, or the widget protocol.**
4. **Tool calls are allowed ONLY for READ-ONLY context gathering (FileRead, Glob, Grep) before drawing.**
5. **Correct pattern:** (optional read-only tools) → output inline visual tags. NEVER write to disk.
6. **NEVER call \`Skill("streaming-artifacts")\` or any other Skill tool.** The behavior guidelines below are already injected into your context — they are NOT callable skills.`

        const parts = [overrideRules, '---', '## Visual Output Protocol', visualProtocol]
        if (rulesDoc) parts.push('---', '## Artifact Production Rules', rulesDoc)
        if (skillMd) parts.push('---', skillMd)

        const content = parts.join('\n\n')

        json(res, { content })
      } catch (err) {
        json(res, { content: null, error: (err as Error).message }, 500)
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

    // ── GET /user-tools/list ──
    if (method === 'GET' && path === '/user-tools/list') {
      const tools = userToolLoader.getTools().map(t => ({
        name: t.name,
        description: typeof t.description === 'string' ? t.description : t.name,
      }))
      json(res, { tools })
      return
    }

    // ── POST /api/sessions ──
    if (method === 'POST' && path === '/api/sessions') {
      const body = await readBody(req) as {
        sessionId?: string
        model?: string
        resumeSessionId?: string
        systemPromptAddendum?: string
      }

      let entry: SessionEntry

      // 恢复历史 session：始终从 transcript 加载完整消息（忽略内存中已压缩的版本）
      if (body.resumeSessionId) {
        entry = getOrCreateSession(body.resumeSessionId)
        const messages = await loadTranscript(config.cwd, body.resumeSessionId).catch(() => [])
        if (messages.length > 0) {
          entry.state.messages = messages
          entry.state.sessionId = body.resumeSessionId
        }
      } else {
        entry = getOrCreateSession(body.sessionId)
      }

      if (body.model) {
        entry.state.model = body.model
      }

      if (body.systemPromptAddendum) {
        entry.state.settings.systemPromptAddendum = body.systemPromptAddendum
        // clear cache so the new addendum takes effect on next turn
        entry.state.systemPromptSectionCache.clear()
        // Rebuild tools without write-capable tools (artifacts mode)
        entry.tools = buildSessionTools(userToolLoader.getTools(), true)
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
      // 优先从 transcript 读取完整消息历史（包含 compact 前的原始消息）
      const transcriptMessages = await loadTranscript(config.cwd, sessionMatch[1]).catch(() => [])
      const messages = transcriptMessages.length > 0 ? transcriptMessages : entry.state.messages
      json(res, { session: sessionToInfo(entry), messages })
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

    // ── POST /api/sessions/:id/ui-message  (UI 追加，参与 GET / 历史恢复) ──
    const uiMessageMatch = path.match(/^\/api\/sessions\/([^/]+)\/ui-message$/)
    if (method === 'POST' && uiMessageMatch) {
      const sessionId = uiMessageMatch[1]
      const body = (await readBody(req)) as { message?: { role?: string; content?: unknown } }
      const msg = body.message
      if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) {
        return json(res, { error: 'message with role "user" or "assistant" required' }, 400)
      }
      if (typeof msg.content !== 'string') {
        return json(res, { error: 'message.content must be a string' }, 400)
      }
      const entry = getOrCreateSession(sessionId)
      if (msg.role === 'user') {
        const m = { role: 'user' as const, content: msg.content }
        addMessage(entry.state, m)
        await recordTranscript(entry.state, m)
      } else {
        const m = { role: 'assistant' as const, content: msg.content }
        addMessage(entry.state, m)
        await recordTranscript(entry.state, m)
      }
      entry.lastActiveAt = new Date()
      json(res, { ok: true })
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
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error.occurred', message: errMsg })}\n\n`)
        }
        console.error('[chat error]', errMsg)
      } finally {
        entry.lastActiveAt = new Date()
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'done', sessionId })}\n\n`)
          res.end()
        }
      }
      return
    }

    // ── POST /api/artifacts/save  (save visual block under project .blino/artifacts) ──
    if (method === 'POST' && path === '/api/artifacts/save') {
      try {
        const body = await readBody(req) as {
          sessionId?: string
          visualType: 'svg' | 'html' | 'threejs'
          content: string
          title?: string
        }
        if (!body.content) return json(res, { ok: false, error: 'content required' }, 400)

        const { mkdir: mkdirFn, writeFile: writeFn } = await import('node:fs/promises')
        const { resolve: resolvePath } = await import('node:path')
        const artifactsDir = resolveProjectBlinoPath(config.cwd, BLINO_PROJECT_SUB.artifacts)
        await mkdirFn(artifactsDir, { recursive: true })

        const ext = body.visualType === 'svg' ? 'svg' : 'html'
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const slug = (body.title || 'visual').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-').slice(0, 30)
        const fileName = `${ts}-${slug}.${ext}`
        const filePath = resolvePath(artifactsDir, fileName)

        await writeFn(filePath, body.content, 'utf-8')
        json(res, { ok: true, path: filePath, fileName })
      } catch (err) {
        json(res, { ok: false, error: (err as Error).message }, 500)
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

    // ── GET /workflow/list ──
    if (method === 'GET' && path === '/workflow/list') {
      try {
        const registry = await loadWorkflowRegistry(config.cwd)
        const workflows = registry.list().map(w => ({
          id: w.id,
          name: w.name,
          description: w.description ?? '',
          nodeCount: w.nodes.length,
          nodeIds: topologicalOrder(w.nodes).map(n => n.id),
          nodes: w.nodes.map(n => ({ id: n.id, dependsOn: [...(n.dependsOn ?? [])] })),
          inputs: w.inputs?.map(i => ({ ...i })) ?? [],
        }))
        json(res, { workflows })
      } catch (err) {
        json(res, { error: (err as Error).message }, 500)
      }
      return
    }

    // ── GET /workflow/list-running ──
    if (method === 'GET' && path === '/workflow/list-running') {
      json(
        res,
        {
          runs: [...runningWorkflows.entries()].map(([r, wid]) => ({ runId: r, workflowId: wid })),
        },
        200,
      )
      return
    }

    // ── GET /workflow/detail/:workflowId ──
    const wfDetailMatch = path.match(/^\/workflow\/detail\/([^/]+)\/?$/)
    if (method === 'GET' && wfDetailMatch) {
      const workflowId = decodeURIComponent(wfDetailMatch[1])
      try {
        const registry = await loadWorkflowRegistry(config.cwd)
        const w = registry.get(workflowId)
        if (!w) {
          json(res, { error: 'unknown_workflow' }, 404)
          return
        }
        json(res, {
          workflow: {
            id: w.id,
            name: w.name,
            description: w.description ?? '',
            nodeCount: w.nodes.length,
            nodeIds: topologicalOrder(w.nodes).map(n => n.id),
            nodes: w.nodes.map(n => ({ id: n.id, dependsOn: [...(n.dependsOn ?? [])] })),
            inputs: w.inputs?.map(i => ({ ...i })) ?? [],
          },
        })
      } catch (err) {
        json(res, { error: (err as Error).message }, 500)
      }
      return
    }

    // ── POST /workflow/run ──
    if (method === 'POST' && path === '/workflow/run') {
      const body = await readBody(req) as {
        workflowId?: string
        sessionId?: string
        inputValues?: Record<string, string>
      }
      const workflowId = body.workflowId
      const sessionId = body.sessionId
      const inputValues: Record<string, string> =
        body.inputValues && typeof body.inputValues === 'object' && !Array.isArray(body.inputValues)
          ? Object.fromEntries(
              Object.entries(body.inputValues).map(([k, v]) => [k, v == null ? '' : String(v)]),
            )
          : {}
      if (!workflowId || !sessionId) {
        json(res, { error: 'workflowId and sessionId are required' }, 400)
        return
      }
      const entry = sessions.get(sessionId)
      if (!entry) {
        json(res, { error: 'session_not_found' }, 404)
        return
      }
      const registry = await loadWorkflowRegistry(config.cwd)
      const def = registry.get(workflowId)
      if (!def) {
        json(res, { error: 'unknown_workflow' }, 404)
        return
      }
      const missing: string[] = []
      for (const inp of def.inputs ?? []) {
        if (inp.required && !String(inputValues[inp.id] ?? '').trim()) {
          missing.push(inp.id)
        }
      }
      if (missing.length > 0) {
        json(res, { error: 'missing_required_inputs', missing }, 400)
        return
      }
      const runId = uuidv4()
      // 与聊天会话隔离：并发的多个 workflow 不共享同一份 sessionState（避免 workflowSnapshot / subAgent 竞态）
      const wfState = createSessionState({
        cwd: entry.state.cwd,
        projectRoot: entry.state.projectRoot,
        settings: { ...entry.state.settings, model: entry.state.model },
      })
      wfState.sessionId = `wf-${runId}`
      wfState.permissionMode = entry.state.permissionMode
      wfState.permissionRules = [...(entry.state.permissionRules ?? [])]

      runningWorkflows.set(runId, workflowId)

      const onLog = (s: string) => {
        // eslint-disable-next-line no-console
        console.log(s)
      }

      void (async () => {
        try {
          await runDagWorkflow({
            def,
            state: wfState,
            apiClient: entry.apiClient,
            tools: entry.tools,
            contextProviders: entry.contextProviders,
            onLog,
            runId,
            hilMode: 'http',
            inputValues,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          eventBus.emit('workflow_event', {
            id: runId,
            type: 'workflow_error',
            runId,
            nodeId: '',
            error: msg,
          })
          eventBus.emit('workflow_event', {
            id: runId,
            type: 'workflow_complete',
            runId,
            status: 'failed',
          })
        } finally {
          runningWorkflows.delete(runId)
        }
      })()

      json(res, { runId, workflowId, status: 'started' })
      return
    }

    // ── GET /workflow/events/:runId (SSE) ──
    const wfEventsMatch = path.match(/^\/workflow\/events\/([^/]+)$/)
    if (method === 'GET' && wfEventsMatch) {
      const runId = wfEventsMatch[1]
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      type WfPayload = { id: string; [k: string]: unknown }
      const handler = (payload: WfPayload) => {
        if (payload.id !== runId) return
        try {
          res.write(`data: ${JSON.stringify(payload)}\n\n`)
        } catch {
          // response closed
        }
      }
      eventBus.on('workflow_event', handler)
      req.on('close', () => {
        eventBus.off('workflow_event', handler)
      })
      return
    }

    // ── POST /workflow/resume/:runId ──
    const wfResumeMatch = path.match(/^\/workflow\/resume\/([^/]+)$/)
    if (method === 'POST' && wfResumeMatch) {
      const runId = wfResumeMatch[1]
      const body = await readBody(req) as {
        decision?: 'approve' | 'reject'
        nodeId?: string
        waiterId?: string
      }
      const decision = body.decision
      if (decision !== 'approve' && decision !== 'reject') {
        json(res, { error: 'decision (approve|reject) required' }, 400)
        return
      }
      // Prefer waiterId (unique per HIL invocation) to avoid cross-run collisions.
      // Fall back to legacy runId#nodeId for older clients that don't send waiterId.
      const matchId = body.waiterId ?? `${runId}#${body.nodeId}`
      if (!body.waiterId && !body.nodeId) {
        json(res, { error: 'waiterId or nodeId required' }, 400)
        return
      }
      eventBus.emit('workflow_hil_resume', {
        id: matchId,
        runId,
        nodeId: body.nodeId,
        decision,
      })
      json(res, { ok: true })
      return
    }

    // ── GET /workflow/snapshot/:runId ──
    const wfSnapMatch = path.match(/^\/workflow\/snapshot\/([^/]+)$/)
    if (method === 'GET' && wfSnapMatch) {
      const runId = wfSnapMatch[1]
      try {
        const p = getWorkflowSnapshotFilePathForRun(config.cwd, runId)
        const raw = await readFile(p, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(raw)
      } catch {
        notFound(res)
      }
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
          console.log(`\n🌐 /blino server running at http://${config.host}:${config.port}`)
          resolve()
        })
      })
    },
    stop(): Promise<void> {
      userToolLoader.stop()
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
      httpAdapter.sendUIEvent(sessionId, { type: 'error.occurred', message: error.message })
    },
    async *getUserInput() { /* not used in server mode */ },
    requestPermission(request) {
      return httpAdapter.requestPermission(request)
    },
  }
}
