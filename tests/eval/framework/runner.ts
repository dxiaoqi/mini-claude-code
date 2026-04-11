/**
 * Evaluation Runner — 执行引擎
 *
 * 流程：
 *   1. 为每个 TestCase 创建独立沙箱（tmpdir）
 *   2. 拷贝 fixture 到沙箱
 *   3. 运行 Agent（捕获完整 trace）
 *   4. 执行 Validator 列表
 *   5. 计算 GRAPE 分数
 *   6. 返回 EvalResult
 */

import { mkdtemp, cp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { EventEmitter } from 'node:events'
import type {
  TestCase, EvalResult, EvalConfig, AgentTrace, ToolCallRecord,
  MessageRecord, TestEnvironment, ValidatorResult, GRAPEScore,
} from './types.js'
import { runValidators } from './oracle/functional.js'
import { calculateGRAPE } from './metrics.js'

export class EvalRunner extends EventEmitter {
  constructor(private config: EvalConfig) {
    super()
  }

  async runCase(testCase: TestCase): Promise<EvalResult> {
    const sandboxPath = await mkdtemp(join(tmpdir(), `eval-${testCase.id}-`))
    const startTime = Date.now()

    this.emit('case:start', { id: testCase.id, sandboxPath })

    try {
      // 1. Setup fixture
      const env: TestEnvironment = {
        cwd: sandboxPath,
        fixtureDir: resolve(import.meta.url.replace('file://', ''), '../../fixtures'),
        traceDir: resolve(this.config.outputDir, 'traces', testCase.id),
      }

      if (testCase.fixture) {
        await this.setupFixture(testCase.fixture, sandboxPath)
      }

      if (testCase.systemContext) {
        await writeFile(join(sandboxPath, 'CLAUDE.md'), testCase.systemContext, 'utf-8')
      }

      if (testCase.setup) {
        await testCase.setup(env)
      }

      // Install deps in sandbox if package.json exists
      await this.maybeInstallDeps(sandboxPath)

      // 2. Run Agent and collect trace
      const trace = await this.runAgent(testCase, sandboxPath)

      // 3. Validate
      const validatorResults = await runValidators(testCase.validators, env, trace)
      const functionalPass = validatorResults.every(r => r.result.passed)
      const passRate = validatorResults.filter(r => r.result.passed).length / validatorResults.length
      const firstFailure = validatorResults.find(r => !r.result.passed)?.result.message

      // 4. Calculate GRAPE
      const grape = await calculateGRAPE(testCase, trace, validatorResults, this.config)

      const result: EvalResult = {
        testCase,
        trace,
        validatorResults,
        grape,
        functionalPass,
        passRate,
        firstFailure,
        runAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        sandboxPath,
      }

      this.emit('case:end', { id: testCase.id, passed: functionalPass, composite: grape.composite })
      return result

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.emit('case:error', { id: testCase.id, error })

      const emptyTrace: AgentTrace = {
        sessionId: 'error', startTime, endTime: Date.now(), durationMs: Date.now() - startTime,
        turnCount: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUSD: 0,
        toolCalls: [], messages: [], agentSpawns: 0, compactionCount: 0,
        permissionDenials: 0, recoveryAttempts: 0, finalResponse: '', exitReason: 'error',
      }

      return {
        testCase, trace: emptyTrace, validatorResults: [],
        grape: { goal: 0, reasoning: 0, action: 0, proof: 0, expression: 0, composite: 0 },
        functionalPass: false, passRate: 0, firstFailure: error,
        runAt: new Date().toISOString(), durationMs: Date.now() - startTime, sandboxPath, error,
      }
    } finally {
      // Cleanup sandbox (keep on failure for debugging if verbose)
      if (!this.config.verbose) {
        await rm(sandboxPath, { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  private async setupFixture(fixtureName: string, targetDir: string): Promise<void> {
    const generatorPath = resolve(process.cwd(), 'tests/eval/fixtures/generators/monorepo.js')
    if (fixtureName === 'monorepo') {
      const { generateMonorepo } = await import(generatorPath)
      await generateMonorepo(targetDir, { withBugs: true, withMissingFeatures: true })
    } else if (fixtureName === 'monorepo-clean') {
      const { generateMonorepo } = await import(generatorPath)
      await generateMonorepo(targetDir, { withBugs: false, withMissingFeatures: false })
    } else if (fixtureName === 'monorepo-perf') {
      const { generateMonorepo } = await import(generatorPath)
      await generateMonorepo(targetDir, { withBugs: true, withPerformanceIssues: true, bugTypes: [] })
    } else {
      const staticDir = resolve(import.meta.url.replace('file://', ''), '../../../fixtures/static', fixtureName)
      await cp(staticDir, targetDir, { recursive: true })
    }
  }

  private async maybeInstallDeps(dir: string): Promise<void> {
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)

    try {
      // Check if there's a package.json and run npm install
      const entries = await readdir(dir)
      if (entries.includes('package.json')) {
        this.emit('log', { msg: 'Installing dependencies...', dir })
        await execAsync('npm install --legacy-peer-deps 2>/dev/null', {
          cwd: dir,
          timeout: 60_000,
        })
      }
    } catch {
      // Ignore install errors — test may still work
    }
  }

  private async runAgent(testCase: TestCase, sandboxPath: string): Promise<AgentTrace> {
    // 直接用 process.cwd()（项目根）定位 src/ 目录
    const srcRoot = resolve(process.cwd(), 'src')
    const imp = (p: string) => import(`${srcRoot}/${p}`)

    const { createAnthropicClient } = await imp('api/anthropicClient.js')
    const { createOpenAICompatibleClient } = await imp('api/client.js')
    const { createSessionState } = await imp('state/SessionState.js')
    const { runAgentLoop } = await imp('engine/AgentEngine.js')
    const { BashTool } = await imp('tools/local/BashTool.js')
    const { FileReadTool } = await imp('tools/local/FileReadTool.js')
    const { FileEditTool } = await imp('tools/local/FileEditTool.js')
    const { FileWriteTool } = await imp('tools/local/FileWriteTool.js')
    const { GlobTool } = await imp('tools/local/GlobTool.js')
    const { GrepTool } = await imp('tools/local/GrepTool.js')
    const { TodoWriteTool } = await imp('tools/interaction/TodoWriteTool.js')
    const { SkillTool } = await imp('tools/interaction/SkillTool.js')
    const { WebFetchTool } = await imp('tools/network/WebFetchTool.js')
    const { createWebSearchTool } = await imp('tools/network/WebSearchTool.js')
    const { createToolSearchTool } = await imp('tools/ToolSearchTool.js')
    const { createAgentTool } = await imp('tools/agent/AgentTool.js')
    const { SendMessageTool } = await imp('tools/agent/SendMessageTool.js')
    const { TaskStopTool } = await imp('tools/agent/TaskStopTool.js')
    const { TaskOutputTool } = await imp('tools/agent/TaskOutputTool.js')
    const { claudeMdProvider } = await imp('context/providers/claudemd.js')
    const { gitContextProvider } = await imp('context/providers/gitContext.js')
    const { dateContextProvider } = await imp('context/providers/dateContext.js')
    const { withRetry } = await imp('api/retry.js')
    const { runCoordinatorMode } = await imp('engine/coordinator/coordinatorMode.js')

    const startTime = Date.now()
    const toolCalls: ToolCallRecord[] = []
    const messages: MessageRecord[] = []
    let agentSpawns = 0
    let compactionCount = 0
    let permissionDenials = 0
    let recoveryAttempts = 0

    // Build API client
    const baseClient = this.config.provider === 'anthropic'
      ? createAnthropicClient({ apiKey: this.config.apiKey, baseURL: this.config.baseUrl || 'https://api.anthropic.com', defaultModel: this.config.model })
      : createOpenAICompatibleClient({ apiKey: this.config.apiKey, baseURL: this.config.baseUrl || '', defaultModel: this.config.model })

    const apiClient = withRetry(baseClient, { maxRetries: 1 })

    // Build state
    const state = createSessionState({
      cwd: sandboxPath,
      settings: { model: this.config.model, permissionMode: 'bypass' },
    })

    // Instrumented adapter (captures all events)
    let turnIndex = 0
    const adapter = {
      onStreamEvent: (event: Record<string, unknown>) => {
        if (event.type === 'tool_use_start') {
          toolCalls.push({
            id: event.id as string,
            name: event.name as string,
            input: event.input as Record<string, unknown>,
            isError: false,
            durationMs: 0,
            turnIndex,
          })
          if ((event.name as string) === 'Agent') agentSpawns++
        }
        if (event.type === 'tool_result') {
          const tc = toolCalls.find(t => t.id === event.toolUseId)
          if (tc) {
            tc.output = String(event.result ?? '').slice(0, 2000)
            tc.isError = event.isError as boolean ?? false
          }
          if (event.isError) recoveryAttempts++
        }
        if (event.type === 'turn_complete') {
          turnIndex++
        }
        if (event.type === 'session_complete' &&
            (event as { reason?: string }).reason?.includes('compact')) {
          compactionCount++
        }
      },
      onToolStart: () => {},
      onToolEnd: () => {},
      onError: () => {},
      getUserInput: async function*() {},
      requestPermission: async () => {
        permissionDenials++
        return { decision: 'allow' as const }
      },
    }

    // Build tools
    const webSearch = createWebSearchTool(apiClient, {
      provider: this.config.provider,
      anthropicApiKey: this.config.apiKey,
      anthropicBaseUrl: this.config.baseUrl,
    })
    const coreTools = [
      BashTool, FileReadTool, FileEditTool, FileWriteTool,
      GlobTool, GrepTool, TodoWriteTool, SkillTool,
      SendMessageTool, TaskStopTool, TaskOutputTool,
    ]
    const deferredTools = [WebFetchTool, webSearch]
    const allBaseTools = [...coreTools, ...deferredTools]
    const toolSearch = createToolSearchTool(allBaseTools)
    const agentTool = createAgentTool(apiClient, allBaseTools, [claudeMdProvider, gitContextProvider, dateContextProvider], async () => ({ behavior: 'allow' as const }))
    const tools = [...allBaseTools, toolSearch, agentTool]

    const contextProviders = [claudeMdProvider, gitContextProvider, dateContextProvider]

    // Run with timeout
    const timeout = testCase.timeoutMs || 120_000
    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(), timeout)

    let exitReason: AgentTrace['exitReason'] = 'completed'

    try {
      if (testCase.useCoordinator) {
        // Coordinator mode
        const userMessage = { role: 'user' as const, content: testCase.prompt }
        state.messages.push(userMessage)

        const loop = runCoordinatorMode(state, {
          apiClient, allTools: tools, contextProviders,
          canUseTool: async () => ({ behavior: 'allow' as const }),
          maxTurns: testCase.maxTurns,
        })

        for (;;) {
          const r = await loop.next()
          if (r.done) {
            exitReason = (r.value as { reason: string }).reason as AgentTrace['exitReason'] || 'completed'
            break
          }
          adapter.onStreamEvent(r.value as unknown as Record<string, unknown>)
        }
      } else {
        const result = await runAgentLoop(
          state,
          { apiClient, tools, adapter, contextProviders, maxTurns: testCase.maxTurns },
          testCase.prompt,
        )
        exitReason = result.reason
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        exitReason = 'timeout'
      } else {
        exitReason = 'error'
      }
    } finally {
      clearTimeout(timer)
    }

    // Extract messages from state
    for (const msg of state.messages) {
      messages.push({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        turnIndex: 0,
        hasToolUse: typeof msg.content !== 'string' && Array.isArray(msg.content) &&
          (msg.content as Array<{type:string}>).some(b => b.type === 'tool_use'),
        hasToolResult: typeof msg.content !== 'string' && Array.isArray(msg.content) &&
          (msg.content as Array<{type:string}>).some(b => b.type === 'tool_result'),
      })
    }

    // Final assistant response
    const lastAssistant = [...state.messages].reverse()
      .find(m => m.role === 'assistant')
    const finalResponse = lastAssistant
      ? (typeof lastAssistant.content === 'string'
        ? lastAssistant.content
        : (lastAssistant.content as Array<{type:string;text?:string}>)
            .filter(b => b.type === 'text').map(b => b.text || '').join('\n'))
      : ''

    return {
      sessionId: state.sessionId,
      startTime,
      endTime: Date.now(),
      durationMs: Date.now() - startTime,
      turnCount: turnIndex,
      totalInputTokens: state.totalInputTokens,
      totalOutputTokens: state.totalOutputTokens,
      totalCostUSD: state.totalCostUSD,
      toolCalls,
      messages,
      agentSpawns,
      compactionCount,
      permissionDenials,
      recoveryAttempts,
      finalResponse,
      exitReason,
    }
  }
}
