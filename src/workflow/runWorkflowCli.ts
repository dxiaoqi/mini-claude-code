/**
 * blino --workflow list | run <id> [--fresh] 的 CLI 实现
 */
import { unlink } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import chalk from 'chalk'
import { createOpenAICompatibleClient } from '../api/client.js'
import { createAnthropicClient } from '../api/anthropicClient.js'
import { createSessionState } from '../state/SessionState.js'
import { loadWorkflowRegistry, getWorkflowRegistry } from './WorkflowRegistry.js'
import { runDagWorkflow } from './DAGEngine.js'
import { getWorkflowSnapshotFilePathForRun } from './snapshotFile.js'
import { resolveApiConfig, loadSettings } from '../utils/config.js'
import { withRetry, withFallback } from '../api/retry.js'
import type { APIClient, ContextProvider, Settings, Tool } from '../types.js'
import { createToolSearchTool } from '../tools/ToolSearchTool.js'
import { createWebSearchTool } from '../tools/network/WebSearchTool.js'
import { BashTool } from '../tools/local/BashTool.js'
import { FileReadTool } from '../tools/local/FileReadTool.js'
import { FileEditTool } from '../tools/local/FileEditTool.js'
import { FileWriteTool } from '../tools/local/FileWriteTool.js'
import { GlobTool } from '../tools/local/GlobTool.js'
import { GrepTool } from '../tools/local/GrepTool.js'
import { NotebookEditTool } from '../tools/local/NotebookEditTool.js'
import { WebFetchTool } from '../tools/network/WebFetchTool.js'
import { ImageReadTool } from '../tools/content/ImageReadTool.js'
import { PDFReadTool } from '../tools/content/PDFReadTool.js'
import { TodoWriteTool } from '../tools/interaction/TodoWriteTool.js'
import { AskUserTool } from '../tools/interaction/AskUserTool.js'
import { SkillTool } from '../tools/interaction/SkillTool.js'
import { SendMessageTool } from '../tools/agent/SendMessageTool.js'
import { TaskStopTool } from '../tools/agent/TaskStopTool.js'
import { TaskOutputTool } from '../tools/agent/TaskOutputTool.js'
import { ListMcpResourcesTool } from '../tools/interaction/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from '../tools/interaction/ReadMcpResourceTool.js'
import { v4 as uuidv4 } from 'uuid'
import { claudeMdProvider } from '../context/providers/claudemd.js'
import { memoryProvider } from '../context/providers/memory.js'
import { gitContextProvider } from '../context/providers/gitContext.js'
import { sessionMemoryProvider } from '../context/providers/sessionMemoryProvider.js'
import { MCPClientManager } from '../mcp/client.js'
import { adaptMCPTools } from '../mcp/toolAdapter.js'
import { loadMCPConfigs } from '../mcp/config.js'
import type { WorkflowDef } from './types.js'

function log(s: string) {
  // eslint-disable-next-line no-console
  console.log(s)
}

/** 与 HTTP POST /workflow/run 一致：required 且无有效值时须补齐，避免 {{var}} 原样进 prompt */
async function collectCliWorkflowInputs(def: WorkflowDef): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const input of def.inputs ?? []) {
    if (input.default !== undefined) {
      out[input.id] = input.default
    }
  }

  const missingRequired = (def.inputs ?? []).filter(
    inp => inp.required && !String(out[inp.id] ?? '').trim(),
  )
  if (missingRequired.length === 0) return out

  if (!process.stdin.isTTY) {
    log(
      chalk.red(
        `[workflow] Missing required inputs (non-interactive): ${missingRequired.map(i => i.id).join(', ')}`,
      ),
    )
    log(chalk.dim('Add default values in the workflow JSON, or run in a terminal to be prompted.'))
    process.exit(1)
  }

  log(chalk.yellow(`[workflow] ${missingRequired.length} required field(s) have no default — enter values:`))
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    for (const inp of missingRequired) {
      const optHint =
        inp.type === 'select' && inp.options?.length
          ? chalk.dim(` Options: ${inp.options.join(' | ')}`)
          : ''
      const ph = inp.placeholder ? chalk.dim(` e.g. ${inp.placeholder}`) : ''
      const q = `${chalk.bold(inp.label)} (${inp.id})${ph}${optHint}\n  `
      for (;;) {
        const line = (await rl.question(q)).trim()
        if (line) {
          out[inp.id] = line
          break
        }
        log(chalk.yellow(`  (required — cannot be empty)`))
      }
    }
  } finally {
    rl.close()
  }
  return out
}

export async function runWorkflowList(cwd: string): Promise<void> {
  const registry = await loadWorkflowRegistry(cwd)
  const list = registry.list()
  if (list.length === 0) {
    log(chalk.yellow('No workflows found. Add .json or .yaml under .blino/workflows/'))
    return
  }
  for (const w of list) {
    log(chalk.cyan(w.id) + chalk.dim(` — ${w.name}`))
    if (w.description) log(chalk.dim('  ' + w.description))
  }
}

export async function runWorkflowRun(
  cwd: string,
  workflowId: string,
  options: { fresh?: boolean } = {},
): Promise<void> {
  const apiCfg = await resolveApiConfig(cwd, {})
  const { provider: providerType, apiKey, baseUrl: baseURL, model, fallbackModel: cfgFallbackModel } = apiCfg
  if (!apiKey) {
    log(chalk.red('Error: API key is required to run a workflow.'))
    process.exit(1)
  }

  let baseClient: APIClient
  if (providerType === 'anthropic') {
    baseClient = createAnthropicClient({
      apiKey,
      baseURL: baseURL || 'https://api.anthropic.com',
      defaultModel: model,
    })
  } else {
    if (!baseURL) {
      log(chalk.red('Error: openaiBaseUrl is required for OpenAI-compatible provider.'))
      process.exit(1)
    }
    baseClient = createOpenAICompatibleClient({
      apiKey,
      baseURL,
      defaultModel: model,
    })
  }

  const fileSettings = await loadSettings(cwd).catch(() => ({} as Settings))
  const fallbackModel = cfgFallbackModel || fileSettings.fallbackModel || process.env.FALLBACK_MODEL
  const retriedClient = withRetry(baseClient, { maxRetries: 2 })
  const apiClient = fallbackModel
    ? withFallback(retriedClient, fallbackModel)
    : retriedClient

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

  const mcpManager = new MCPClientManager()
  const mcpTools: Tool[] = []
  try {
    const mcpConfigs = await loadMCPConfigs(cwd)
    for (const config of mcpConfigs) {
      try {
        const conn = await mcpManager.connect(config)
        mcpTools.push(...adaptMCPTools(config.name, conn.tools, conn.client))
      } catch { /* ignore */ }
    }
  } catch { /* */ }

  const coreTools: Tool[] = [
    BashTool, FileReadTool, FileEditTool, FileWriteTool,
    GlobTool, GrepTool,
    TodoWriteTool, AskUserTool, SkillTool,
    SendMessageTool, TaskStopTool, TaskOutputTool,
  ]
  const deferredTools: Tool[] = [
    WebFetchTool, webSearchTool, NotebookEditTool,
    ImageReadTool, PDFReadTool,
    ListMcpResourcesTool, ReadMcpResourceTool,
  ]
  const allBaseTools = [...coreTools, ...deferredTools, ...mcpTools]
  const toolSearchTool = createToolSearchTool(allBaseTools)
  const tools: Tool[] = [...allBaseTools, toolSearchTool]

  const contextProviders: ContextProvider[] = [
    claudeMdProvider, memoryProvider, gitContextProvider, sessionMemoryProvider,
  ]

  const state = createSessionState({
    cwd,
    projectRoot: cwd,
    settings: {
      model,
      permissionMode: 'bypass',
      permissionRules: fileSettings.permissionRules,
    },
  })

  const registry = await loadWorkflowRegistry(cwd)
  const def = registry.get(workflowId)
  if (!def) {
    log(chalk.red(`Unknown workflow: ${workflowId}`))
    log(chalk.dim('Run: blino --workflow list'))
    process.exit(1)
  }

  const workflowRunId = uuidv4()
  const snapPath = getWorkflowSnapshotFilePathForRun(cwd, workflowRunId)
  if (options.fresh) {
    try {
      await unlink(snapPath)
      log(chalk.dim(`[workflow] --fresh: removed snapshot, will run all nodes`))
    } catch (e) {
      const c = (e as NodeJS.ErrnoException).code
      if (c !== 'ENOENT') throw e
    }
  }
  log(chalk.dim(`[workflow] running "${def.name}" (${def.id})`))
  log(chalk.dim(`[workflow] runId: ${workflowRunId}`))
  log(chalk.dim(`[workflow] snapshot file: ${snapPath}`))

  const initialInputs = await collectCliWorkflowInputs(def)

  const onLog = (s: string) => log(s)
  const result = await runDagWorkflow({
    def,
    state,
    apiClient,
    tools,
    contextProviders,
    onLog,
    runId: workflowRunId,
    hilMode: 'cli',
    inputValues: initialInputs,
  })

  await mcpManager.disconnectAll().catch(() => {})

  if (result.ok) {
    log(chalk.green(`[workflow] completed`))
  } else {
    log(chalk.yellow(`[workflow] finished with error: ${result.lastError || 'unknown'}`))
    process.exit(1)
  }
}
