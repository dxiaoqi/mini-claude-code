import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath, join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { UIEvent } from '../../types.js'
import { ClaudeCodeSessionManager } from './session.js'
import { ClaudeCodeTranslator } from './translator.js'

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
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
      try { resolve(body ? JSON.parse(body) : {}) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function sendSSE(res: ServerResponse, event: UIEvent): void {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
}

function buildVisualContext(): string | null {
  try {
    const fileDir = resolvePath(fileURLToPath(import.meta.url), '..')
    const skillRoot = resolvePath(fileDir, '..', '..', '..', 'ui', 'skill-pack')
    const read = (name: string) => { try { return readFileSync(joinPath(skillRoot, name), 'utf-8') } catch { return '' } }

    const visualProtocol = read('visual-protocol.md')
    if (!visualProtocol) return null

    const overrideRules = `\
## ⚠️ ARTIFACTS MODE — VISUAL GENERATION OVERRIDE RULES (HIGHEST PRIORITY)

1. **NEVER use Bash, ShellTool, or any tool to install graphviz, dot, plantuml, or any diagram software.**
2. **NEVER use FileWrite or any file tool to write content — not diagrams, not HTML, not any output. ALL content must be output inline using the visual protocol tags below.**
3. **When the user asks for a diagram, chart, interactive UI, or any visual: ALWAYS generate it inline using \`<visual type="svg">\`, \`<visual type="html">\`, or the widget protocol.**
4. **Tool calls are allowed ONLY for READ-ONLY context gathering (FileRead, Glob, Grep) before drawing.**
5. **Correct pattern:** (optional read-only tools) → output inline visual tags. NEVER write to disk.
6. **NEVER call \`Skill("streaming-artifacts")\` or any other Skill tool.** The behavior guidelines below are already injected into your context — they are NOT callable skills.`

    const parts = [overrideRules, '---', '## Visual Output Protocol', visualProtocol]
    const rulesDoc = read('rules.md')
    const skillMd = read('SKILL.md')
    if (rulesDoc) parts.push('---', '## Artifact Production Rules', rulesDoc)
    if (skillMd) parts.push('---', skillMd)
    return parts.join('\n\n')
  } catch {
    return null
  }
}

// ── 服务器创建 ────────────────────────────────────────────────────────────────

export interface ClaudeCodeServerConfig {
  port: number
  host: string
  cwd: string
}

export async function createClaudeCodeServer(config: ClaudeCodeServerConfig) {
  const sessions = new ClaudeCodeSessionManager()
  // per-session system prompt addendum (set when artifacts mode is active)
  const sessionAddendums = new Map<string, string>()

  const server = createServer(async (req, res) => {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', `http://${config.host}`)
    const path = url.pathname

    // ── GET /api/visual-context ──
    if (method === 'GET' && path === '/api/visual-context') {
      const content = buildVisualContext()
      if (!content) return json(res, { content: null }, 404)
      json(res, { content })
      return
    }

    // ── GET /api/config ──
    if (method === 'GET' && path === '/api/config') {
      try {
        const { loadProjectConfig } = await import('../../utils/config.js')
        const projectConfig = await loadProjectConfig(config.cwd)
        json(res, { renderer: projectConfig.renderer ?? null })
      } catch {
        json(res, { renderer: null })
      }
      return
    }

    // ── POST /api/sessions ──
    if (method === 'POST' && path === '/api/sessions') {
      const body = await readBody(req) as { resumeSessionId?: string; systemPromptAddendum?: string }
      let session = body.resumeSessionId
        ? sessions.get(body.resumeSessionId)
        : undefined
      if (!session) session = sessions.create(config.cwd)
      if (body.systemPromptAddendum) {
        sessionAddendums.set(session.localId, body.systemPromptAddendum)
      }
      json(res, { session: { id: session.localId, createdAt: session.createdAt } })
      return
    }

    // ── GET /api/sessions ──
    if (method === 'GET' && path === '/api/sessions') {
      const active = sessions.list().map(s => ({
        id: s.localId,
        claudeSessionId: s.claudeSessionId,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
      }))
      json(res, { active, history: [] })
      return
    }

    // ── GET /api/sessions/:id ──
    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/)
    if (method === 'GET' && sessionMatch) {
      const session = sessions.get(sessionMatch[1])
      if (!session) return json(res, { error: 'Session not found' }, 404)
      json(res, {
        session: { id: session.localId, claudeSessionId: session.claudeSessionId },
        messages: [],
      })
      return
    }

    // ── POST /api/sessions/:id/chat ──
    const chatMatch = path.match(/^\/api\/sessions\/([^/]+)\/chat$/)
    if (method === 'POST' && chatMatch) {
      const localId = chatMatch[1]
      const body = await readBody(req) as { message?: string; systemPromptAddendum?: string }
      if (!body.message?.trim()) return json(res, { error: 'message is required' }, 400)

      let session = sessions.get(localId)
      if (!session) session = sessions.create(config.cwd)
      sessions.touch(session.localId)

      // update addendum if provided per-turn
      if (body.systemPromptAddendum) {
        sessionAddendums.set(session.localId, body.systemPromptAddendum)
      }
      const addendum = sessionAddendums.get(session.localId)

      // SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      })

      const args = [
        '--print', body.message.trim(),
        '--output-format', 'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--permission-mode', 'auto',
      ]
      if (session.claudeSessionId) {
        args.push('--resume', session.claudeSessionId)
      }
      if (addendum) {
        args.push('--append-system-prompt', addendum)
      }

      const proc = spawn('claude', args, {
        cwd: session.cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const translator = new ClaudeCodeTranslator()
      const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity })

      rl.on('line', (line) => {
        const result = translator.translate(line)

        // 更新 claude session_id
        if (result.claudeSessionId) {
          sessions.setClaudeSessionId(session!.localId, result.claudeSessionId)
        }

        // 权限请求 → 发给 UI（informational only，--permission-mode auto 已自动允许）
        if (result.permissionRequest) {
          const requestId = randomUUID()
          const { toolName, input } = result.permissionRequest

          sendSSE(res, {
            type: 'permission.request',
            requestId,
            toolName,
            input: input as Record<string, unknown>,
            message: `Allow ${toolName}?`,
            riskLevel: 'medium',
          })
          return
        }

        // 普通事件推送
        for (const event of result.events) {
          sendSSE(res, event)
        }
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim()
        if (msg) sendSSE(res, { type: 'error.occurred', message: msg })
      })

      proc.on('close', (code) => {
        translator.reset()
        if (code !== 0 && code !== null) {
          sendSSE(res, { type: 'error.occurred', message: `Claude Code exited with code ${code}` })
        }
        sendSSE(res, { type: 'done', sessionId: session!.localId })
        if (!res.writableEnded) res.end()
      })

      req.on('close', () => {
        try { proc.kill() } catch { /* ignore */ }
      })

      return
    }

    notFound(res)
  })

  return {
    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          console.log(`\n🔌 Claude Code adapter running at http://${config.host}:${config.port}`)
          resolve()
        })
      })
    },
    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve())
      })
    },
  }
}
