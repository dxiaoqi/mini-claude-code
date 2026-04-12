/**
 * Agent Loop — 核心执行引擎
 *
 * 实现 while(true) 的"思考-行动-观察"循环：
 *   Phase 0: 上下文预处理（tool result budget + 压缩管线）
 *   Phase 1: 构建 System Prompt
 *   Phase 2: 过滤 deferred 工具，构建 API tool schemas
 *   Phase 3: 流式 API 调用 + StreamingToolExecutor 并行工具执行
 *   Phase 4: 收集工具结果
 *   Phase 5: 终止/恢复判定（max_output_tokens / prompt_too_long）
 *
 * 状态更新策略：直接修改 state 对象的属性（messages 赋新数组），
 * 保证 caller 持有的 state 引用始终看到最新数据。
 */

import type {
  APIClient,
  AssistantMessage,
  CanUseToolFn,
  ContentBlock,
  ContextProvider,
  Message,
  SessionState,
  StreamEvent,
  Tool,
  ToolContext,
  ToolResultBlock,
  ToolUseBlock,
  Usage,
} from '../types.js'
import { handleSilentError } from '../errors/handlers.js'
import { findToolByName, getAPIToolSchemas } from '../tools/registry.js'
import { buildSystemPrompt } from '../context/systemPrompt.js'
import { accumulateUsage } from '../state/SessionState.js'
import { applyToolResultBudget } from './toolResultBudget.js'
import { recordTranscript } from '../state/transcript.js'
import { CompactPipeline } from '../compact/pipeline.js'
import { tryReactiveCompact } from '../compact/reactiveCompact.js'
import { StreamingToolExecutor } from './StreamingToolExecutor.js'
import { runStopHooks } from '../utils/hooks.js'
import type { HooksSettings } from '../utils/hooks.js'

export interface AgentLoopParams {
  /** 会话状态（直接引用，内部会修改其属性） */
  state: SessionState
  /** API 客户端 */
  apiClient: APIClient
  /** 可用工具列表（含 deferred 工具） */
  tools: Tool[]
  /** 上下文提供者列表 */
  contextProviders: ContextProvider[]
  /** 权限检查回调 */
  canUseTool: CanUseToolFn
  /** 最大轮次限制（默认 100） */
  maxTurns?: number
  /** 中断信号 */
  signal?: AbortSignal
  /** AskUserTool 回调（交互模式下注入） */
  askUser?: (question: string, options?: Array<{ id: string; label: string }>) => Promise<string>
  /** MCP 资源工具使用的客户端管理器 */
  mcpManager?: { getAllConnections(): unknown[] }
}

export type AgentLoopResult = {
  reason: 'completed' | 'max_turns' | 'aborted' | 'error' | 'prompt_too_long'
  turnCount: number
}

/** 输出截断恢复最大次数 */
const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3
/** 恢复模式的输出 token 上限 */
const ESCALATED_MAX_TOKENS = 64_000

export async function* agentLoop(
  params: AgentLoopParams,
): AsyncGenerator<StreamEvent, AgentLoopResult> {
  const { state } = params
  let turnCount = 0
  let maxOutputTokensRecoveryCount = 0
  let maxOutputTokensOverride: number | undefined
  let hasAttemptedReactiveCompact = false
  const maxTurns = params.maxTurns ?? 100
  const compactPipeline = new CompactPipeline()

  // 记录已通过 ToolSearch 发现的工具名（用于 deferred loading 过滤）
  const discoveredToolNames = new Set<string>()

  while (true) {
    if (params.signal?.aborted) {
      return { reason: 'aborted', turnCount }
    }
    if (turnCount >= maxTurns) {
      return { reason: 'max_turns', turnCount }
    }

    // ── Phase 0a: 工具结果大小限制（超限持久化到磁盘）──
    state.messages = await applyToolResultBudget(state.messages, state.sessionId)

    // ── Phase 0b: 分层压缩管线（snip → micro → collapse → auto）──
    const compactResult = await compactPipeline.run(
      state.messages,
      params.apiClient,
      state.model,
      state,  // 传入 state 以更新 autoCompactTracking / lastSummarizedMessageId
    )
    if (compactResult.wasCompacted) {
      state.messages = compactResult.messages
    }

    // ── Phase 1: 构建 System Prompt ──
    const systemPrompt = await buildSystemPrompt(state, params.tools, params.contextProviders)

    // ── Phase 2: 过滤 deferred 工具，构建 API schema ──
    const activeTools = filterActiveTools(params.tools, discoveredToolNames)
    const toolSchemas = getAPIToolSchemas(activeTools)

    // ── Phase 3: 流式 API 调用 ──
    const apiStream = params.apiClient.callModel({
      model: state.model,
      systemPrompt,
      messages: state.messages,
      tools: toolSchemas,
      maxOutputTokens: maxOutputTokensOverride,
      signal: params.signal,
      promptCacheLatches: state.promptCacheLatches,
    })

    // 用于收集本轮 assistant 消息内容
    const assistantContentBlocks: ContentBlock[] = []
    let currentUsage: Usage = { inputTokens: 0, outputTokens: 0 }
    let stopReason = 'end_turn'
    let currentModel = state.model
    let currentText = ''

    // 创建工具执行上下文（注入回调给各工具使用）
    const toolContext: ToolContext = {
      sessionState: state,
      cwd: state.cwd,
      abortController: new AbortController(),
      options: { tools: params.tools, mainModel: state.model },
      askUser: params.askUser,
      mcpManager: params.mcpManager,
      logger: state.settings?.logger as any,
    }

    // assistant 消息引用（StreamingToolExecutor 需要）
    const assistantMessage: AssistantMessage = {
      role: 'assistant',
      content: assistantContentBlocks, // 共享引用，后续 push 自动可见
    }

    // 流式并行工具执行器：工具在流式过程中即开始执行
    const streamingExecutor = new StreamingToolExecutor(
      params.tools, toolContext, params.canUseTool, assistantMessage,
    )

    try {
      for await (const event of apiStream) {
        if (event.type === 'tool_use_start') {
          // ── backfillObservableInput: 在克隆副本上丰富 input 给 observers ──
          // 原始 input 保持不变用于 API 回传（保护 Prompt Cache 字节稳定性）
          const tool = findToolByName(event.name, params.tools)
          let yieldEvent = event

          if (tool?.backfillObservableInput) {
            const inputClone = { ...event.input }
            tool.backfillObservableInput(inputClone)
            const addedFields = Object.keys(inputClone).some(k => !(k in event.input))
            if (addedFields) {
              yieldEvent = { ...event, input: inputClone }
            }
          }

          yield yieldEvent

          // 记录为已发现工具（用于 deferred loading）
          discoveredToolNames.add(event.name)

          // 累积的文本 → text block
          if (currentText) {
            assistantContentBlocks.push({ type: 'text', text: currentText })
            currentText = ''
          }

          // 构建 tool_use block
          const block: ToolUseBlock = {
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: event.input, // 原始 input（cache-safe）
          }
          assistantContentBlocks.push(block)

          // 立即启动工具执行（流式过程中并行）
          streamingExecutor.addTool(block)
          continue
        }

        yield event

        switch (event.type) {
          case 'text_delta':
            currentText += event.text
            break
          case 'message_start':
            currentModel = event.model
            break
          case 'message_end':
            if (currentText) {
              assistantContentBlocks.push({ type: 'text', text: currentText })
              currentText = ''
            }
            currentUsage = event.usage
            stopReason = event.stopReason
            accumulateUsage(state, event.usage, currentModel)
            // 记录本轮实际 inputTokens，供下轮 summaryCompact 做精确阈值判断
            if (event.usage.inputTokens > 0) {
              state.lastTurnInputTokens = event.usage.inputTokens
            }
            break
          case 'error':
            return { reason: 'error', turnCount }
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      const statusCode = extractStatusCode(error)

      // ── 413 prompt_too_long 恢复链 ──
      if (statusCode === 413 || error.message.includes('prompt_too_long') || error.message.includes('too long')) {
        streamingExecutor.discard()

        // 第一步：drain staged 折叠
        const drainResult = compactPipeline.drainCollapses(state.messages)
        if (drainResult.committed > 0) {
          state.messages = drainResult.messages
          continue
        }

        // 第二步：reactive compact（仅尝试一次）
        if (!hasAttemptedReactiveCompact) {
          hasAttemptedReactiveCompact = true
          const reactiveResult = await tryReactiveCompact({
            messages: state.messages,
            apiClient: params.apiClient,
            model: state.model,
            hasAttempted: false,
          })
          if (reactiveResult) {
            state.messages = reactiveResult.messages
            continue
          }
        }

        yield { type: 'error', error: new Error('Context too long — all compaction strategies exhausted') }
        return { reason: 'prompt_too_long', turnCount }
      }

      yield { type: 'error', error }
      return { reason: 'error', turnCount }
    }

    // 剩余文本
    if (currentText) {
      assistantContentBlocks.push({ type: 'text', text: currentText })
    }

    // 最终化 assistant 消息（如果只有空内容则标记为空字符串）
    ;(assistantMessage as { content: ContentBlock[] | string }).content =
      assistantContentBlocks.length > 0 ? assistantContentBlocks : ''

    // ── Phase 4: 收集工具结果（StreamingToolExecutor 已并行执行完毕）──
    if (streamingExecutor.hasTools()) {
      state.messages = [...state.messages, assistantMessage]

      const toolResultBlocks = await streamingExecutor.getRemainingResults()

      for (const result of toolResultBlocks) {
        yield {
          type: 'tool_result',
          toolName: findToolNameById(assistantContentBlocks, result.tool_use_id),
          toolUseId: result.tool_use_id,
          result: result.content,
          isError: result.is_error,
        }
      }

      const toolResultMessage: Message = { role: 'user', content: toolResultBlocks }
      state.messages = [...state.messages, toolResultMessage]

      // Transcript 录入 assistant + tool results
      await recordTranscript(state, assistantMessage).catch(err => {
        handleSilentError(err, { sessionId: state.sessionId, context: 'transcript' })
      })
      await recordTranscript(state, toolResultMessage).catch(err => {
        handleSilentError(err, { sessionId: state.sessionId, context: 'transcript' })
      })

      turnCount++
      yield { type: 'turn_complete', turnCount, usage: currentUsage }
      continue
    }

    // ── Phase 5a: max_output_tokens 截断恢复（最多 3 次）──
    if (stopReason === 'length' || stopReason === 'max_tokens') {
      maxOutputTokensRecoveryCount++

      if (maxOutputTokensRecoveryCount > MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
        if (assistantMessage.content) {
          state.messages = [...state.messages, assistantMessage]
        }
        yield { type: 'error', error: new Error('Output token limit exceeded after 3 recovery attempts') }
        return { reason: 'error', turnCount }
      }

      // 首次恢复：提升 maxOutputTokens 到 64K
      if (maxOutputTokensRecoveryCount === 1) {
        maxOutputTokensOverride = ESCALATED_MAX_TOKENS
      }

      const newMessages = [...state.messages]
      if (assistantMessage.content) newMessages.push(assistantMessage)
      newMessages.push({
        role: 'user',
        content: 'Output token limit hit. Resume directly from where you stopped. Do not repeat any content.',
      })
      state.messages = newMessages

      turnCount++
      yield { type: 'turn_complete', turnCount, usage: currentUsage }
      continue
    }

    // ── Phase 5b: 无工具调用 → 执行 Stop Hook → 完成 ──
    if (assistantMessage.content) {
      state.messages = [...state.messages, assistantMessage]
      await recordTranscript(state, assistantMessage).catch(err => {
        handleSilentError(err, { sessionId: state.sessionId, context: 'transcript' })
      })
    }

    turnCount++
    yield { type: 'turn_complete', turnCount, usage: currentUsage }

    if (stopReason === 'tool_use') {
      continue
    }

    // Stop Hook：Agent 完成时执行，可阻止退出
    const hooksSettings = state.settings?.hooks as HooksSettings | undefined
    if (hooksSettings?.Stop?.length) {
      const stopResult = await runStopHooks(
        hooksSettings,
        state.sessionId,
        turnCount,
        state.cwd,
      ).catch(err => {
        handleSilentError(err, { sessionId: state.sessionId, context: 'stop_hook' })
        return null
      })

      if (stopResult?.preventContinuation && stopResult.blockingMessage) {
        state.messages = [
          ...state.messages,
          { role: 'user', content: `[Stop hook blocked]: ${stopResult.blockingMessage}` },
        ]
        continue  // AI 重新思考
      }
    }

    return { reason: 'completed', turnCount }
  }
}

/**
 * 过滤 deferred 工具：只有被 ToolSearch 发现过的 deferred 工具才发给 API。
 * ToolSearch 本身和 alwaysLoad 工具始终包含。
 */
function filterActiveTools(tools: Tool[], discoveredNames: Set<string>): Tool[] {
  return tools.filter(tool => {
    if (tool.alwaysLoad) return true
    if (tool.name === 'ToolSearch') return true
    if (!tool.shouldDefer) return true
    return discoveredNames.has(tool.name)
  })
}

/** 从 content blocks 中按 tool_use_id 查找工具名 */
function findToolNameById(blocks: ContentBlock[], toolUseId: string): string {
  for (const block of blocks) {
    if (block.type === 'tool_use' && (block as ToolUseBlock).id === toolUseId) {
      return (block as ToolUseBlock).name
    }
  }
  return 'unknown'
}

/** 从错误对象中提取 HTTP 状态码 */
function extractStatusCode(err: Error): number | null {
  const anyErr = err as unknown as Record<string, unknown>
  if (typeof anyErr.status === 'number') return anyErr.status
  if (typeof anyErr.statusCode === 'number') return anyErr.statusCode
  const match = err.message.match(/\b(4\d{2}|5\d{2})\b/)
  return match ? parseInt(match[1], 10) : null
}
