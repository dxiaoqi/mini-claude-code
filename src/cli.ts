#!/usr/bin/env node

/**
 * cli.ts — CLI 入口
 *
 * 使用 Commander.js 解析参数，并按模式分发到交互式 REPL、管道（Pipe）或 Coordinator。
 */
import { Command } from 'commander'
import { createOpenAICompatibleClient } from './api/client.js'
import { createAnthropicClient } from './api/anthropicClient.js'
import { createSessionState } from './state/SessionState.js'
import { TerminalAdapter } from './adapters/terminal.js'
import { PipeAdapter } from './adapters/pipe.js'
import { runAgentLoop } from './engine/AgentEngine.js'
import { BashTool } from './tools/local/BashTool.js'
import { FileReadTool } from './tools/local/FileReadTool.js'
import { FileEditTool } from './tools/local/FileEditTool.js'
import { FileWriteTool } from './tools/local/FileWriteTool.js'
import { GlobTool } from './tools/local/GlobTool.js'
import { GrepTool } from './tools/local/GrepTool.js'
import { NotebookEditTool } from './tools/local/NotebookEditTool.js'
import { WebFetchTool } from './tools/network/WebFetchTool.js'
import { createWebSearchTool } from './tools/network/WebSearchTool.js'
import { ImageReadTool } from './tools/content/ImageReadTool.js'
import { PDFReadTool } from './tools/content/PDFReadTool.js'
import { createToolSearchTool } from './tools/ToolSearchTool.js'
import { SkillTool, invalidateSkillCache } from './tools/interaction/SkillTool.js'
import { advanceWorkflowPhase } from './utils/workflowRuntime.js'
import { TodoWriteTool, clearTodos } from './tools/interaction/TodoWriteTool.js'
import { AskUserTool } from './tools/interaction/AskUserTool.js'
import { createAgentTool } from './tools/agent/AgentTool.js'
import { ListMcpResourcesTool } from './tools/interaction/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from './tools/interaction/ReadMcpResourceTool.js'
import { isCoordinatorMode, runCoordinatorMode } from './engine/coordinator/coordinatorMode.js'
import { recordTranscript, listSessions, loadTranscript } from './state/transcript.js'
import { checkToolPermission } from './permissions/engine.js'
import { SendMessageTool } from './tools/agent/SendMessageTool.js'
import { TaskStopTool } from './tools/agent/TaskStopTool.js'
import { TaskOutputTool } from './tools/agent/TaskOutputTool.js'
import { MCPClientManager } from './mcp/client.js'
import { adaptMCPTools } from './mcp/toolAdapter.js'
import { loadMCPConfigs } from './mcp/config.js'
import { claudeMdProvider } from './context/providers/claudemd.js'
import { memoryProvider } from './context/providers/memory.js'
import { gitContextProvider } from './context/providers/gitContext.js'
import { sessionMemoryProvider } from './context/providers/sessionMemoryProvider.js'
import { withRetry, withFallback } from './api/retry.js'
import { findAvailablePort, readServerLock, writeServerLock, registerLockCleanup } from './utils/portManager.js'
import { processAttachments, buildContentWithAttachments } from './utils/attachments.js'
import { resolveApiConfig, loadSettings, persistPermissionRules, showConfig, saveApiConfig } from './utils/config.js'
import { apiCompact } from './compact/apiCompact.js'
import { estimateMessagesTokens } from './compact/tokenEstimator.js'
import { flushTranscript } from './state/transcript.js'
import { DevTraceRecorder } from './state/devTrace.js'
import { restoreSnapshot, listSnapshotFiles, clearSnapshots } from './state/fileHistory.js'
import { clearSnipArchive, restoreLastSnip, getArchivedMessageCount } from './compact/snipCompact.js'
import { formatCost, formatTokens, estimateCost } from './utils/cost.js'
import type { APIClient, ContextProvider, Message, Settings, Tool } from './types.js'
import { createLogger } from './logging/index.js'
import chalk from 'chalk'

const VERSION = '0.1.0'

// Initialize logger
// 交互式终端（TTY）下默认 warn，避免 INFO 结构化日志污染 CLI 输出；
// 需要详细日志时可通过 LOG_LEVEL=info/debug 环境变量覆盖。
const defaultLogLevel = process.stdout.isTTY ? 'warn' : 'info'
const logger = createLogger({
  name: 'blino-cli',
  level: (process.env.LOG_LEVEL as any) || defaultLogLevel,
  pretty: process.stdout.isTTY,
  development: process.env.NODE_ENV !== 'production',
})

const program = new Command()

program
  .name('blino')
  .description('Blino — AI coding assistant')
  .version(VERSION)
  .option('--api-key <key>', 'API key (reads from ~/.blino/settings.json if not set)')
  .option('--base-url <url>', 'API base URL')
  .option('--model <model>', 'Model name')
  .option('--provider <type>', 'API provider: anthropic or openai (auto-detected)')
  .option('-p, --pipe', 'Pipe mode: read from stdin, auto-approve tools')
  .option('--bypass-permissions', 'Auto-approve all tool calls')
  .option('--coordinator', 'Run in Coordinator mode (multi-agent orchestration)')
  .option('--resume [sessionId]', 'Resume a previous session (omit sessionId to pick from list)')
  .option('--serve', 'Start HTTP server for web UI')
  .option('--tui', 'Start HTTP server + open browser (same as --serve + auto-open)')
  .option('--port <port>', 'HTTP server port (default: 3001)')
  .option('--host <host>', 'HTTP server host (default: localhost)')
  .option(
    '--cors-origin <origin>',
    'CORS: comma-separated list of allowed web UI origins, or * (default: *). ' +
    'In dev, http://localhost:<port> and http://127.0.0.1:<port> are treated as the same when the port matches.',
  )
  .option('--config', 'Show current effective configuration')
  .option('--dev', 'Dev mode: record full session trace (messages, tool calls, tokens) to ~/.blino/projects/<hash>/<sessionId>.trace.jsonl')
  .argument('[prompt]', 'Initial prompt (or pipe via stdin with -p)')

program
  .command('init')
  .description('Install built-in project skills (skill-creator) into .blino/skills/')
  .option('--force', 'Overwrite existing .blino/skills/skill-creator.md')
  .action(async (opts: { force?: boolean }) => {
    const { installSkillCreator } = await import('./utils/installSkillCreator.js')
    const r = await installSkillCreator(process.cwd(), { force: opts.force === true })
    if (r.ok) {
      console.log(r.message)
      console.log(r.path)
      process.exit(0)
    } else {
      console.error(chalk.red(r.message))
      process.exit(1)
    }
  })

program.action(async (prompt: string | undefined, options: Record<string, unknown>) => {
  const cwd = process.cwd()

  // ── --config: 显示当前有效配置 ──
  if (options.config) {
    await showConfig(cwd)
    process.exit(0)
  }

  // ── 解析 API 配置（配置文件 → 环境变量 → CLI 参数，后者优先）──
  const apiCfg = await resolveApiConfig(cwd, {
    apiKey: options.apiKey as string | undefined,
    baseUrl: options.baseUrl as string | undefined,
    model: options.model as string | undefined,
    provider: options.provider as string | undefined,
  })

  const { provider: providerType, apiKey, baseUrl: baseURL, model, fallbackModel: cfgFallbackModel } = apiCfg

  if (!apiKey) {
    console.error(chalk.red('Error: API key is required.'))
    console.error(chalk.dim('Set it via:'))
    console.error(chalk.dim('  1. ~/.blino/settings.json  →  { "api": { "anthropicApiKey": "..." } }'))
    console.error(chalk.dim('  2. Environment variable ANTHROPIC_API_KEY or OPENAI_API_KEY'))
    console.error(chalk.dim('  3. CLI flag --api-key'))
    process.exit(1)
  }

  const isTui = (options.tui as boolean)
  const isServe = (options.serve as boolean) || isTui
  const isPipe = options.pipe as boolean
  const bypassPermissions = options.bypassPermissions as boolean
  const useCoordinator = (options.coordinator as boolean) || isCoordinatorMode()
  const resumeOption = options.resume as string | boolean | undefined

  // ── 创建 API 客户端 ──
  let baseClient: APIClient

  if (providerType === 'anthropic') {
    baseClient = createAnthropicClient({
      apiKey,
      baseURL: baseURL || 'https://api.anthropic.com',
      defaultModel: model,
    })
  } else {
    if (!baseURL) {
      console.error(chalk.red('Error: API base URL is required for OpenAI compatible provider.'))
      console.error(chalk.dim('Set it via openaiBaseUrl in ~/.blino/settings.json or OPENAI_BASE_URL env.'))
      process.exit(1)
    }
    baseClient = createOpenAICompatibleClient({
      apiKey,
      baseURL,
      defaultModel: model,
    })
  }

  // Wrap with retry + fallback
  const fileSettings = await loadSettings(cwd).catch(() => ({} as Settings))
  const isDevMode = (options.dev as boolean) || (fileSettings.devTrace === true)
  const fallbackModel = cfgFallbackModel || fileSettings.fallbackModel || process.env.FALLBACK_MODEL

  const retriedClient = withRetry(baseClient, { maxRetries: 2 })
  const apiClient = fallbackModel
    ? withFallback(retriedClient, fallbackModel)
    : retriedClient

  const state = createSessionState({
    cwd,
    settings: {
      ...fileSettings,
      model,
      permissionMode: bypassPermissions
        ? 'bypass'
        : (isPipe
          ? 'bypass'
          : (fileSettings.permissionMode || 'default')),
      permissionRules: fileSettings.permissionRules,
      logger,
    },
  })

  logger.info('Session initialized', {
    sessionId: state.sessionId,
    cwd,
    model,
    permissionMode: state.permissionMode,
  })

  // ── Dev Trace 初始化 ──────────────────────────────────────────────────────
  let devTraceRecorder: DevTraceRecorder | undefined
  if (isDevMode) {
    devTraceRecorder = new DevTraceRecorder(state.projectRoot, state.sessionId)
    await devTraceRecorder.record({
      type: 'session_start',
      sessionId: state.sessionId,
      model: state.model,
      cwd: state.cwd,
      timestamp: new Date().toISOString(),
    })
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Core tools (always loaded)
  const coreTools: Tool[] = [
    BashTool, FileReadTool, FileEditTool, FileWriteTool,
    GlobTool, GrepTool,
    TodoWriteTool, AskUserTool, SkillTool,
    SendMessageTool, TaskStopTool, TaskOutputTool,
  ]

  // WebSearchTool：双模式（Anthropic native / Tavily fallback）
  // tavilyApiKey: 支持顶层 tavilyApiKey 和 api.tavilyApiKey 两种配置方式
  const tavilyApiKey =
    (fileSettings.tavilyApiKey as string | undefined) ||
    (fileSettings.api as Record<string, unknown> | undefined)?.tavilyApiKey as string | undefined ||
    process.env.TAVILY_API_KEY

  const webSearchTool = createWebSearchTool(apiClient, {
    provider: providerType as 'anthropic' | 'openai',
    anthropicApiKey: apiKey,
    anthropicBaseUrl: baseURL,
    tavilyApiKey,
  })

  // Deferred tools（通过 ToolSearch 发现后加载）
  const deferredTools: Tool[] = [
    WebFetchTool, webSearchTool, NotebookEditTool,
    ImageReadTool, PDFReadTool,
    ListMcpResourcesTool, ReadMcpResourceTool,
  ]

  // Connect MCP servers
  const mcpManager = new MCPClientManager()
  const mcpTools: Tool[] = []

  try {
    const mcpConfigs = await loadMCPConfigs(process.cwd())
    for (const config of mcpConfigs) {
      try {
        const conn = await mcpManager.connect(config)
        const adapted = adaptMCPTools(config.name, conn.tools, conn.client)
        mcpTools.push(...adapted)
        if (!isPipe) {
          console.log(chalk.dim(`MCP: Connected to ${config.name} (${conn.tools.length} tools)`))
        }
      } catch (err) {
        if (!isPipe) {
          console.log(chalk.yellow(`MCP: Failed to connect to ${config.name}: ${(err as Error).message}`))
        }
      }
    }
  } catch { /* No MCP config — that's fine */ }

  // Context providers
  const contextProviders: ContextProvider[] = [
    claudeMdProvider,
    memoryProvider,
    gitContextProvider,
    sessionMemoryProvider,
  ]

  // 组装完整工具列表
  const allBaseTools = [...coreTools, ...deferredTools, ...mcpTools]
  const toolSearchTool = createToolSearchTool(allBaseTools)

  // AgentTool：子 Agent 权限策略
  //   - pipe/bypass 模式：全部自动通过
  //   - 交互模式：读操作自动通过，写操作通过权限引擎检查
  const agentTool = createAgentTool(apiClient, allBaseTools, contextProviders, async (tool, input, msg) => {
    if (isPipe || bypassPermissions) {
      return { behavior: 'allow' as const }
    }
    // 交互模式下子 Agent 的读操作自动通过，写操作走权限检查
    if (tool.isReadOnly?.(input as never)) {
      return { behavior: 'allow' as const }
    }
    const toolContext = {
      sessionState: state,
      cwd: state.cwd,
      abortController: new AbortController(),
      options: { tools: allBaseTools, mainModel: state.model },
      logger,
    }
    return checkToolPermission(tool, input, toolContext)
  })

  const tools: Tool[] = [...allBaseTools, toolSearchTool, agentTool]

  if (isPipe) {
    // Pipe mode
    let input = prompt || ''

    if (!input) {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer)
      }
      input = Buffer.concat(chunks).toString('utf-8').trim()
    }

    if (!input) {
      console.error('Error: No input provided.')
      process.exit(1)
    }

    const adapter = new PipeAdapter()

    // Pipe 模式也支持 @ 附件预处理
    const { cleanText: pipeCleanText, blocks: pipeBlocks, attachmentSummaries: pipeSummaries } =
      await processAttachments(input, state.cwd)
    if (pipeSummaries.length > 0) {
      process.stderr.write(`Attachments: ${pipeSummaries.join(', ')}\n`)
    }
    const pipeFinalContent = buildContentWithAttachments(pipeCleanText, pipeBlocks)

    await runAgentLoop(state, {
      apiClient,
      tools,
      adapter,
      contextProviders,
      devTraceRecorder,
    }, pipeFinalContent)

    if (devTraceRecorder) {
      await devTraceRecorder.record({
        type: 'session_end',
        reason: 'completed',
        totalTurns: state.messages.filter(m => m.role === 'assistant').length,
        totalInputTokens: state.totalInputTokens,
        totalOutputTokens: state.totalOutputTokens,
        timestamp: new Date().toISOString(),
      })
    }

    process.exit(0)
  }

  // ── HTTP Server 模式 ──
  if (isServe) {
    const { createBlinoServer } = await import('./server/index.js')
    const allBaseToolsForServer: Tool[] = [
      BashTool, FileReadTool, FileEditTool, FileWriteTool,
      GlobTool, GrepTool,
      TodoWriteTool, AskUserTool, SkillTool,
      SendMessageTool, TaskStopTool, TaskOutputTool,
      // deferred 工具
      WebFetchTool, webSearchTool, NotebookEditTool, ImageReadTool, PDFReadTool,
      ListMcpResourcesTool, ReadMcpResourceTool,
    ]
    // 重新连接 MCP（server 模式下也需要）
    for (const cfg of await loadMCPConfigs(process.cwd()).catch(() => [])) {
      try {
        const conn = await mcpManager.connect(cfg)
        allBaseToolsForServer.push(...adaptMCPTools(cfg.name, conn.tools, conn.client))
      } catch { /* ignore */ }
    }
    const toolSearchForServer = createToolSearchTool(allBaseToolsForServer)
    const agentToolForServer = createAgentTool(apiClient, allBaseToolsForServer, contextProviders, async () => ({ behavior: 'allow' as const }))
    const allToolsForServer: Tool[] = [...allBaseToolsForServer, toolSearchForServer, agentToolForServer]

    const requestedPort = parseInt((options.port as string) || process.env.PORT || '3001', 10)
    const host = (options.host as string) || process.env.HOST || 'localhost'

    // ── 检查当前 workspace 是否已有实例在运行 ──
    const existingLock = await readServerLock(cwd)
    if (existingLock) {
      const { buildTuiBrowserUrl } = await import('./utils/tuiUrls.js')
      const url = isTui
        ? buildTuiBrowserUrl(existingLock.host, existingLock.port)
        : `http://${existingLock.host}:${existingLock.port}`
      console.log(chalk.yellow(
        `⚡ blino server already running for this workspace (port ${existingLock.port}, pid ${existingLock.pid})`
      ))
      if (isTui) {
        console.log(chalk.cyan(`🌐 Opening browser: ${url}`))
        await openBrowser(url)
      } else {
        console.log(chalk.dim(`API: ${url}/api`))
      }
      return  // 不重复启动
    }

    // ── 自动探测可用端口 ──
    let port: number
    try {
      port = await findAvailablePort(requestedPort, host)
      if (port !== requestedPort) {
        console.log(chalk.yellow(
          `⚠ Port ${requestedPort} is in use — using port ${port} instead`
        ))
      }
    } catch (portErr) {
      console.error(chalk.red((portErr as Error).message))
      process.exit(1)
    }

    const uiPort = 3000
    const manualCors = (options.corsOrigin as string) || process.env.CORS_ORIGIN
    const {
      buildTuiCorsOrigins,
      buildTuiPublicApiBaseUrl,
      buildTuiBrowserUrl,
      isBindAll,
    } = await import('./utils/tuiUrls.js')
    const corsOrigin = manualCors
      || (isTui ? buildTuiCorsOrigins(host, uiPort) : `http://${host}:3002`)
    if (isTui) {
      const tuiPublicApi = buildTuiPublicApiBaseUrl(host, port, process.env)
      const fromEnv = [process.env.BLINO_PUBLIC_API_URL, process.env.NEXT_PUBLIC_BLINO_URL]
        .some(v => typeof v === 'string' && v.trim().length > 0)
      const hostHint = manualCors
        ? '--cors-origin / CORS_ORIGIN'
        : isBindAll(host)
          ? 'localhost, 127.0.0.1, LAN'
          : (host === 'localhost' || host === '127.0.0.1')
            ? 'localhost, 127.0.0.1'
            : `localhost, 127.0.0.1, ${host}`
      console.log(
        chalk.dim(
          `${manualCors ? 'CORS: override' : 'CORS: auto'} — ${hostHint} (UI :${uiPort})` +
            ` | API base for UI: ${tuiPublicApi}${fromEnv ? ' (from BLINO_PUBLIC_API_URL / NEXT_PUBLIC_BLINO_URL)' : (isBindAll(host) ? ' (set BLINO_PUBLIC_API_URL for public URL)' : '')}`,
        ),
      )
    }

    // 静态文件目录
    const { resolve: resolvePath } = await import('node:path')
    const { fileURLToPath: fu } = await import('node:url')
    const __dir = resolvePath(fu(import.meta.url), '..')
    const { statSync } = await import('node:fs')
    const webDist = [
      resolvePath(__dir, '..', 'web-dist'),
      resolvePath(__dir, '..', 'ui', 'out'),
    ].find(p => { try { statSync(p); return true } catch { return false } })

    const server = createBlinoServer({
      port, host, corsOrigin,
      apiClient,
      tools: allToolsForServer,
      contextProviders,
      mcpManager,
      cwd,
      defaultModel: model,
      webDistPath: webDist,
    })

    // 写入 workspace 锁文件，注册退出清理
    await writeServerLock(cwd, port, host)
    registerLockCleanup(cwd)

    process.on('SIGINT', async () => {
      console.log('\nShutting down...')
      await server.stop()
      await mcpManager.disconnectAll()
      process.exit(0)
    })
    // Note: UI child process (if started by --tui) is killed via process.on('exit') registered after spawn

    await server.start()

    // --tui: start the UI server and open the browser
    if (isTui) {
      const { spawn } = await import('node:child_process')
      const { resolve: resolvePath2, join: joinPath } = await import('node:path')
      const { fileURLToPath: fu2 } = await import('node:url')
      const { existsSync: es2 } = await import('node:fs')
      const __dir2 = resolvePath2(fu2(import.meta.url), '..')
      // In prod dist/ lives one level below package root; in dev src/ lives one level below too
      const pkgRoot = resolvePath2(__dir2, '..')

      const standaloneServer = joinPath(pkgRoot, 'ui-standalone', 'server.js')
      const uiDir = joinPath(pkgRoot, 'ui')
      /** Full clone / npm link: prefer live Next dev so UI matches ui/src (old ui-standalone won’t hide new features). */
      const hasUiSource = es2(joinPath(uiDir, 'src', 'app', 'page.tsx'))
      const forceStandalone = process.env.BLINO_UI_STANDALONE === '1'
      const useStandaloneUi = es2(standaloneServer) && (forceStandalone || !hasUiSource)

      const publicApi = buildTuiPublicApiBaseUrl(host, port)
      /** Next `next dev` must bind a concrete host; 0.0.0.0/:: is not valid in the browser. */
      const nextHostname = isBindAll(host) ? '127.0.0.1' : (host || '127.0.0.1')
      const uiEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PORT: String(uiPort),
        HOSTNAME: nextHostname,
        BLINO_API_URL: publicApi,
        NEXT_PUBLIC_BLINO_URL: publicApi,
      }
      if (isBindAll(host) && (nextHostname === '127.0.0.1' || nextHostname === 'localhost')) {
        uiEnv.HOST = nextHostname
      }

      let uiProc: ReturnType<typeof spawn>

      if (useStandaloneUi) {
        // ── Production: pre-built standalone server (npm install, no ui/src) ─
        console.log(chalk.cyan(`\n🖥  Starting UI server (standalone, port ${uiPort})…`))
        uiProc = spawn(process.execPath, [standaloneServer], {
          cwd: pkgRoot,
          stdio: 'inherit',
          env: uiEnv,
        })
      } else {
        // ── Development: Next.js dev server ───────────────────────────────
        console.log(chalk.cyan(`\n🖥  Starting UI dev server (port ${uiPort})…`))
        if (hasUiSource) {
          console.log(chalk.dim('   (using ui/src — run npm run build:web before publish; BLINO_UI_STANDALONE=1 to force bundled UI)'))
        }
        uiProc = spawn('npm', ['run', 'dev', '--', '--port', String(uiPort), '-H', nextHostname], {
          cwd: uiDir,
          stdio: 'inherit',
          shell: true,
          env: uiEnv,
        })
      }

      uiProc.on('error', (err) => {
        console.error(chalk.yellow(`⚠ UI process error: ${err.message}`))
      })

      process.on('exit', () => { try { uiProc.kill() } catch { /* ignore */ } })

      // Wait for UI to be ready, then open browser
      const uiUrl = buildTuiBrowserUrl(host, uiPort)
      const warmUpMs = useStandaloneUi ? 2000 : 4000
      setTimeout(async () => {
        console.log(chalk.cyan(`🌐 Opening browser: ${uiUrl}`))
        await openBrowser(uiUrl)
      }, warmUpMs)
    }

    return  // 保持进程运行
  }

  // Interactive REPL mode
  const adapter = new TerminalAdapter()

  // ── --resume 会话恢复 ──
  if (resumeOption !== undefined) {
    let targetSessionId: string | null = null

    if (typeof resumeOption === 'string' && resumeOption.length > 0) {
      // 直接指定 session ID
      targetSessionId = resumeOption
    } else {
      // 列出最近的会话供选择
      const sessions = await listSessions(process.cwd()).catch(() => [] as { sessionId: string; modifiedAt: Date }[])
      if (sessions.length === 0) {
        console.log(chalk.yellow('No previous sessions found.'))
      } else {
        console.log(chalk.bold('Recent sessions:'))
        sessions.slice(0, 10).forEach((s, i) => {
          const ago = Math.floor((Date.now() - s.modifiedAt.getTime()) / 60000)
          const timeStr = ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`
          console.log(chalk.dim(`  ${i + 1}. ${s.sessionId} (${timeStr})`))
        })

        const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout })
        const answer = await new Promise<string>(resolve => {
          rl.question(chalk.yellow('\nSelect session number (or paste ID): '), resolve)
        })
        rl.close()

        const num = parseInt(answer.trim(), 10)
        if (!isNaN(num) && num >= 1 && num <= sessions.slice(0, 10).length) {
          targetSessionId = sessions[num - 1].sessionId
        } else if (answer.trim().length > 5) {
          targetSessionId = answer.trim()
        }
      }
    }

    if (targetSessionId) {
      const resumedMessages = await loadTranscript(process.cwd(), targetSessionId).catch(() => [])
      if (resumedMessages.length > 0) {
        state.messages = resumedMessages
        state.sessionId = targetSessionId
        console.log(chalk.green(`✓ Resumed session ${targetSessionId} (${resumedMessages.length} messages)`))
      } else {
        console.log(chalk.yellow(`Session ${targetSessionId} not found or empty.`))
      }
    }
  }

  console.log(chalk.bold.cyan('╔══════════════════════════════════════╗'))
  console.log(chalk.bold.cyan('║      Blino v' + VERSION + '        ║'))
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝'))
  console.log(chalk.dim(`Provider: ${providerType} | Model: ${model}${useCoordinator ? ' | Mode: Coordinator' : ''}`))
  console.log(chalk.dim(`CWD: ${process.cwd()}`))
  if (devTraceRecorder) {
    console.log(chalk.yellow(`[Dev] Tracing → ${devTraceRecorder.path}`))
  }
  console.log(chalk.dim('Type /help for available commands\n'))

  // AskUserTool 的交互回调（REPL 模式下通过 readline 向用户提问）
  const askUser = isPipe ? undefined : async (
    question: string,
    options?: Array<{ id: string; label: string }>,
  ): Promise<string> => {
    const readline = await import('node:readline')
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      let prompt = chalk.yellow(`\n❓ ${question}`)

      // 渲染多选项
      if (options && options.length > 0) {
        prompt += '\n'
        options.forEach((opt, i) => {
          prompt += chalk.dim(`  ${i + 1}. ${opt.label}\n`)
        })
        prompt += chalk.yellow('Enter number or text: ')
      } else {
        prompt += chalk.yellow('\n> ')
      }

      rl.question(prompt, (answer) => {
        rl.close()
        const trimmed = answer.trim()
        if (!trimmed) {
          resolve('[No answer provided]')
          return
        }
        // 如果用户输入数字，转换为对应选项 label
        if (options && options.length > 0) {
          const num = parseInt(trimmed, 10)
          if (!isNaN(num) && num >= 1 && num <= options.length) {
            resolve(options[num - 1].label)
            return
          }
        }
        resolve(trimmed)
      })
    })
  }

  const engineConfig = { apiClient, tools, adapter, contextProviders, askUser, mcpManager, devTraceRecorder }

  // Coordinator-aware run function
  async function runQuery(userContent: string) {
    // @ 附件预处理：展开 @file.txt / @image.png
    const { cleanText, blocks, attachmentSummaries } = await processAttachments(userContent, state.cwd)
    const finalContent = buildContentWithAttachments(cleanText, blocks)
    if (attachmentSummaries.length > 0) {
      console.log(chalk.dim(`Attachments: ${attachmentSummaries.join(', ')}`))
    }

    if (useCoordinator) {
      const userMessage: Message = { role: 'user', content: finalContent }
      state.messages = [...state.messages, userMessage]
      await recordTranscript(state, userMessage).catch(() => {})

      const mcpNames = mcpManager.getConnectedNames()
      const loop = runCoordinatorMode(state, {
        apiClient,
        allTools: tools,
        contextProviders,
        canUseTool: async () => ({ behavior: 'allow' as const }),
        mcpServerNames: mcpNames,
        maxTurns: 50,
      })

      // Dev trace 状态（coordinator 模式）
      const coordToolStartTimes = new Map<string, number>()
      let coordTurn = 0
      let coordTurnStart = Date.now()
      let coordTextBuffer = ''

      for (;;) {
        const iterResult = await loop.next()
        if (iterResult.done) break

        const event = iterResult.value
        adapter.onStreamEvent(event)

        if (devTraceRecorder) {
          if (event.type === 'message_start') {
            coordTurn++
            coordTurnStart = Date.now()
            coordTextBuffer = ''
            await devTraceRecorder.record({ type: 'turn_start', turn: coordTurn, timestamp: new Date().toISOString() })
          } else if (event.type === 'text_delta') {
            coordTextBuffer += event.text
          } else if (event.type === 'tool_use_start') {
            if (coordTextBuffer) {
              await devTraceRecorder.record({ type: 'text', turn: coordTurn, text: coordTextBuffer })
              coordTextBuffer = ''
            }
            coordToolStartTimes.set(event.id, Date.now())
            await devTraceRecorder.record({ type: 'tool_call', turn: coordTurn, name: event.name, toolUseId: event.id, input: event.input, startedAt: new Date().toISOString() })
          } else if (event.type === 'tool_result') {
            const startMs = coordToolStartTimes.get(event.toolUseId) ?? Date.now()
            coordToolStartTimes.delete(event.toolUseId)
            await devTraceRecorder.record({ type: 'tool_result', turn: coordTurn, name: event.toolName, toolUseId: event.toolUseId, output: event.result, durationMs: Date.now() - startMs, isError: event.isError ?? false })
          } else if (event.type === 'turn_complete') {
            if (coordTextBuffer) {
              await devTraceRecorder.record({ type: 'text', turn: coordTurn, text: coordTextBuffer })
              coordTextBuffer = ''
            }
            await devTraceRecorder.record({ type: 'turn_end', turn: event.turnCount, inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, durationMs: Date.now() - coordTurnStart, timestamp: new Date().toISOString() })
          } else if (event.type === 'error') {
            await devTraceRecorder.record({ type: 'error', turn: coordTurn, message: event.error.message, timestamp: new Date().toISOString() })
          }
        }

        if (event.type === 'tool_use_start') {
          adapter.onToolStart(event.name, event.input)
        }
        if (event.type === 'tool_result') {
          adapter.onToolEnd(event.toolName, { data: event.result })
        }
        if (event.type === 'error') {
          adapter.onError(event.error)
        }
      }
    } else {
      await runAgentLoop(state, engineConfig, finalContent)
    }
  }

  // Handle initial prompt from args
  if (prompt) {
    await runQuery(prompt)
  }

  // Interactive loop
  for await (const userInput of adapter.getUserInput()) {
    if (userInput === '/clear') {
      await flushTranscript(state).catch(() => {})
      const { clearSession } = await import('./state/SessionState.js')
      clearSession(state)
      clearSnapshots()
      clearSnipArchive()
      invalidateSkillCache(state.sessionId)
      clearTodos()
      console.log(chalk.dim('[Session cleared]'))
      continue
    }

    if (userInput.startsWith('/undo')) {
      const filePath = userInput.slice(5).trim()
      if (!filePath) {
        const files = listSnapshotFiles()
        const snipCount = getArchivedMessageCount()
        if (files.length === 0 && snipCount === 0) {
          console.log(chalk.dim('[No undo history available]'))
        } else {
          if (files.length > 0) {
            console.log(chalk.dim('Files with snapshots (use /undo <path>):'))
            for (const f of files) {
              console.log(chalk.dim(`  ${f.filePath} (${f.count} snapshot(s))`))
            }
          }
          if (snipCount > 0) {
            console.log(chalk.dim(`Archived messages: ${snipCount} (use /undo --snip to restore last snip)`))
          }
        }
      } else if (filePath === '--snip') {
        // 恢复最近一次 snip 归档的消息
        const restored = restoreLastSnip()
        if (restored) {
          state.messages = [...restored, ...state.messages]
          console.log(chalk.green(`✓ Restored ${restored.length} archived messages to context`))
        } else {
          console.log(chalk.yellow('[No snip archive to restore]'))
        }
      } else {
        const { resolve: resolvePath } = await import('node:path')
        const absPath = resolvePath(process.cwd(), filePath)
        const result = await restoreSnapshot(state, absPath)
        console.log(result.success ? chalk.green(result.message) : chalk.red(result.message))
      }
      continue
    }

    if (userInput === '/trace') {
      if (devTraceRecorder) {
        console.log(chalk.dim(`Dev trace: ${devTraceRecorder.path}`))
      } else {
        console.log(chalk.yellow('[Dev mode is not active. Start with --dev flag or set "devTrace": true in settings.json]'))
      }
      continue
    }

    if (userInput === '/phase' || userInput === '/phase next' || userInput === '/phase prev') {
      const which = userInput.trim() === '/phase' ? 'next' : userInput.split(/\s+/)[1] || 'next'
      const delta = which === 'prev' ? -1 : 1
      const r = advanceWorkflowPhase(state, delta)
      console.log(r.ok ? chalk.green(r.message) : chalk.yellow(r.message))
      if (r.ok) {
        state.systemPromptSectionCache.clear()
        invalidateSkillCache(state.sessionId)
      }
      continue
    }

    if (userInput === '/status') {
      // 优先使用 totalCostUSD（由 accumulateUsage 精确累加），
      // 仅当为 0 时用 estimateCost 兜底（首次 /status 且还未调用工具）
      const displayCost = state.totalCostUSD > 0
        ? state.totalCostUSD
        : estimateCost(state.model, state.totalInputTokens, state.totalOutputTokens)
      console.log(chalk.dim(`Session: ${state.sessionId}`))
      console.log(chalk.dim(`Model: ${state.model} | Provider: ${providerType}`))
      console.log(chalk.dim(`Messages: ${state.messages.length}`))
      console.log(chalk.dim(`Tokens: ${formatTokens(state.totalInputTokens)} in / ${formatTokens(state.totalOutputTokens)} out`))
      console.log(chalk.dim(`Cost: ${formatCost(displayCost)}`))
      // 按模型细分显示
      if (state.modelUsage.size > 1) {
        for (const [m, usage] of state.modelUsage) {
          console.log(chalk.dim(`  ${m}: ${formatTokens(usage.input)}↑ ${formatTokens(usage.output)}↓`))
        }
      }
      continue
    }

    if (userInput === '/help') {
      console.log(chalk.bold('\nAvailable commands:'))
      const cmds = [
        ['/help',                   '显示此帮助'],
        ['/clear',                  '清空会话（重置消息、token、权限规则、快照）'],
        ['/compact',                '手动压缩上下文（调 LLM 生成对话摘要）'],
        ['/plan',                   '进入只读 Plan Mode（写操作被拒绝）'],
        ['/plan off',               '退出 Plan Mode'],
        ['/status',                 '查看当前会话状态（token / 成本 / 模型）'],
        ['/phase', '/phase next',   'workflow 多阶段时切换到下一阶段（.blino/workflow.json）'],
        ['/phase prev',              '回退到上一阶段'],
        ['/model <name>',           '切换模型'],
        ['/undo',                   '列出可回滚的文件快照和 snip 归档'],
        ['/undo <file_path>',       '回滚指定文件到修改前状态'],
        ['/undo --snip',            '恢复最近一次 snip 归档的消息到上下文'],
        ['/resume',                 '从历史 session 恢复（列出最近10条）'],
        ['/resume <sessionId>',     '直接恢复指定 session'],
        ['/export',                 '导出当前会话为 JSON'],
        ['/export md',              '导出当前会话为 Markdown'],
        ['/config',                 '查看当前配置'],
        ['/config set <key> <val>', '写入配置（如 api.model / api.anthropicApiKey）'],
        ['/trace',                  '显示当前 dev trace 文件路径（需 --dev 模式）'],
        ['/exit',                   '退出'],
      ]
      for (const [cmd, desc] of cmds) {
        console.log(`  ${chalk.cyan(cmd.padEnd(32))} ${chalk.dim(desc)}`)
      }
      console.log()
      continue
    }

    if (userInput === '/resume' || userInput.startsWith('/resume ')) {
      const targetId = userInput.slice(7).trim()
      if (targetId) {
        const messages = await loadTranscript(cwd, targetId).catch(() => [])
        if (messages.length > 0) {
          state.messages = messages
          state.sessionId = targetId
          console.log(chalk.green(`✓ Resumed session ${targetId} (${messages.length} messages)`))
        } else {
          console.log(chalk.yellow(`Session "${targetId}" not found or empty.`))
        }
      } else {
        const sessions = await listSessions(cwd).catch(() => [] as { sessionId: string; modifiedAt: Date }[])
        if (sessions.length === 0) {
          console.log(chalk.dim('[No previous sessions found]'))
        } else {
          console.log(chalk.bold('Recent sessions:'))
          sessions.slice(0, 10).forEach((s, i) => {
            const ago = Math.floor((Date.now() - s.modifiedAt.getTime()) / 60000)
            const timeStr = ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`
            console.log(chalk.dim(`  ${i + 1}. ${s.sessionId.slice(0, 16)}… (${timeStr})`))
          })
          console.log(chalk.dim('Usage: /resume <sessionId>'))
        }
      }
      continue
    }

    if (userInput === '/export' || userInput.startsWith('/export ')) {
      const format = userInput.slice(7).trim() || 'json'
      if (format === 'md' || format === 'markdown') {
        // Markdown 格式导出
        const lines: string[] = [`# Session ${state.sessionId}`, '']
        for (const msg of state.messages) {
          if (msg.role === 'system') continue
          const role = msg.role === 'user' ? '**User**' : '**Assistant**'
          const text = typeof msg.content === 'string'
            ? msg.content
            : (msg.content as Array<{type: string; text?: string}>)
                .filter(b => b.type === 'text').map(b => b.text || '').join('\n')
          lines.push(`${role}:\n\n${text}`, '')
        }
        const md = lines.join('\n')
        const path = `session-${state.sessionId.slice(0, 8)}.md`
        const { writeFile } = await import('node:fs/promises')
        await writeFile(path, md, 'utf-8')
        console.log(chalk.green(`✓ Exported to ${path}`))
      } else {
        // JSON 格式导出
        const path = `session-${state.sessionId.slice(0, 8)}.json`
        const { writeFile } = await import('node:fs/promises')
        await writeFile(path, JSON.stringify({ sessionId: state.sessionId, messages: state.messages }, null, 2), 'utf-8')
        console.log(chalk.green(`✓ Exported to ${path}`))
      }
      continue
    }

    if (userInput === '/config') {
      await showConfig(cwd)
      continue
    }

    if (userInput.startsWith('/config set ')) {
      const parts = userInput.slice(12).split(' ')
      const key = parts[0]
      const value = parts.slice(1).join(' ')
      if (key === 'model') {
        state.model = value
        console.log(chalk.green(`Model set to: ${value}`))
      } else if (key === 'api.anthropicApiKey') {
        await saveApiConfig('user', cwd, { anthropicApiKey: value })
        console.log(chalk.green('Saved anthropicApiKey to ~/.blino/settings.json'))
      } else if (key === 'api.anthropicBaseUrl') {
        await saveApiConfig('user', cwd, { anthropicBaseUrl: value })
        console.log(chalk.green('Saved anthropicBaseUrl to ~/.blino/settings.json'))
      } else if (key === 'api.openaiApiKey') {
        await saveApiConfig('user', cwd, { openaiApiKey: value })
        console.log(chalk.green('Saved openaiApiKey to ~/.blino/settings.json'))
      } else if (key === 'api.model') {
        await saveApiConfig('user', cwd, { model: value })
        console.log(chalk.green(`Saved default model to ~/.blino/settings.json`))
      } else {
        console.log(chalk.yellow(`Unknown config key: ${key}`))
        console.log(chalk.dim('Available: model, api.anthropicApiKey, api.anthropicBaseUrl, api.openaiApiKey, api.model'))
      }
      continue
    }

    if (userInput === '/plan') {
      state.permissionMode = 'plan'
      console.log(chalk.yellow('[Plan mode: ON — read-only, write operations blocked]'))
      continue
    }

    if (userInput === '/plan off' || userInput === '/exit-plan') {
      state.permissionMode = 'default'
      console.log(chalk.green('[Plan mode: OFF — normal permissions restored]'))
      continue
    }

    if (userInput === '/compact') {
      const tokensBefore = estimateMessagesTokens(state.messages)
      console.log(chalk.dim(`[Compacting... (${formatTokens(tokensBefore)} tokens)]`))

      const result = await apiCompact({
        messages: state.messages,
        apiClient,
        model: state.model,
      })

      if (result) {
        state.messages = result.messages
        const tokensAfter = estimateMessagesTokens(state.messages)
        state.systemPromptSectionCache.clear()
        console.log(chalk.green(
          `[Compacted: ${formatTokens(tokensBefore)} → ${formatTokens(tokensAfter)} tokens ` +
          `(freed ~${formatTokens((result.freedTokens || 0))})]`
        ))
      } else {
        console.log(chalk.yellow('[Compact failed — no changes made]'))
      }
      continue
    }

    if (userInput.startsWith('/model ')) {
      state.model = userInput.slice(7).trim()
      console.log(chalk.dim(`[Model changed to: ${state.model}]`))
      continue
    }

    try {
      await runQuery(userInput)
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
    }
  }

  // Persist session-level permission rules to local config
  const sessionRules = state.permissionRules.filter(r => r.source === 'session')
  if (sessionRules.length > 0) {
    await persistPermissionRules('local', process.cwd(), state.permissionRules).catch(() => {})
  }

  await flushTranscript(state).catch(() => {})

  // ── Dev Trace 收尾 ────────────────────────────────────────────────────────
  if (devTraceRecorder) {
    await devTraceRecorder.record({
      type: 'session_end',
      reason: 'exit',
      totalTurns: state.messages.filter(m => m.role === 'assistant').length,
      totalInputTokens: state.totalInputTokens,
      totalOutputTokens: state.totalOutputTokens,
      timestamp: new Date().toISOString(),
    })
    console.log(chalk.yellow(`[Dev] Trace saved → ${devTraceRecorder.path}`))
  }
  // ─────────────────────────────────────────────────────────────────────────

  await mcpManager.disconnectAll().catch(() => {})
  await adapter.destroy()
  console.log(chalk.dim('\nGoodbye!'))
  process.exit(0)
})

/** 打开默认浏览器（跨平台） */
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process')
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "${url}"`
    : `xdg-open "${url}"`
  exec(cmd, (err) => {
    if (err) console.error(chalk.yellow(`Could not open browser automatically. Visit: ${url}`))
  })
}

program.parse()
