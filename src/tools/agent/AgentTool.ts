/**
 * AgentTool — 子 Agent 派生工具
 *
 * 通过工厂函数创建可派生子 Agent 的工具：子任务在独立消息上下文中运行，与主会话隔离直至结束。
 */
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { buildTaskNotification } from '../../engine/coordinator/coordinatorMode.js'
import type { AgentSnapshot } from '../../workflow/types.js'
import type {
  AgentHandle,
  APIClient,
  AssistantMessage,
  CanUseToolFn,
  ContentBlock,
  ContextProvider,
  Message,
  PermissionResult,
  SessionState,
  Tool,
  ToolContext,
  ToolResult,
  Usage,
} from '../../types.js'
import { agentLoop } from '../../engine/agentLoop.js'
import { dateContextProvider } from '../../context/providers/dateContext.js'
import { logSubagentDebug } from '../../utils/subagentDebug.js'
import type { AgentLoopResult } from '../../engine/agentLoop.js'

const inputSchema = z.object({
  prompt: z.string().describe('The task description for the sub-agent'),
  allowed_tools: z
    .array(z.string())
    .optional()
    .describe('Omit = all tools; empty = text-only, no tools; non-empty = whitelist by tool name'),
})

type Input = z.infer<typeof inputSchema>

function extractTextFromAssistantMessage(msg: Message): string {
  if (msg.role !== 'assistant') return ''
  if (typeof msg.content === 'string') return msg.content.trim()
  return (msg.content as ContentBlock[])
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()
}

/**
 * 无工具子 Agent 仍可能从训练分布中输出仿 tool_call 的文本；从结果中剔除，避免污染下游节点。
 */
function stripBogusToolLikeText(s: string): string {
  let out = s
  out = out.replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, '')
  out = out.replace(/<tool_call\b[\s\S]*$/i, '')
  out = out.replace(/```\s*tool[_\s]*\n[\s\S]*?```/gi, '')
  out = out.replace(/^\s*<function=[A-Za-z0-9_]+[^\n]*/gim, '')
  out = out.replace(/<arguments=\{[^}]*\}\s*>?/gi, '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

const MESSAGE_PREVIEW = 500

function buildMessageSummary(messages: Message[], max = 10): Array<{ role: string; preview: string }> {
  const slice = messages.length <= max ? messages : messages.slice(-max)
  return slice.map((m) => {
    const role = m.role
    if (m.role === 'user' || m.role === 'assistant') {
      if (typeof m.content === 'string') {
        return { role, preview: m.content.slice(0, MESSAGE_PREVIEW) }
      }
      return {
        role,
        preview: m.content
          .map(b =>
            b.type === 'text' && 'text' in b
              ? b.text
              : b.type === 'tool_use' && 'name' in b
                ? `(${b.type} ${(b as { name: string }).name})`
                : `(${b.type})`,
          )
          .join(' ')
          .slice(0, MESSAGE_PREVIEW),
      }
    }
    if (m.role === 'system') {
      return { role, preview: (m as { content: string }).content.slice(0, MESSAGE_PREVIEW) }
    }
    return { role, preview: '…' }
  })
}

function putSubAgentSnapshot(parent: SessionState, agentId: string, snap: AgentSnapshot) {
  parent.workflowSubAgentSnapshots = { ...parent.workflowSubAgentSnapshots, [agentId]: snap }
}

/** 子 Agent 成功结束时的 data（失败时抛错，不经过此结构） */
export interface AgentToolSuccessOutput {
  agentId: string
  result: string
  /** 正常完成但无任何文本（与执行失败抛错区分） */
  emptyOutput?: true
  /** 子 Agent 最后一轮 message_end 的 stopReason；如 content_filter 时下游可判为拒绝输出 */
  stopReason?: string
  turnCount: number
  usage: Usage
}

/**
 * Creates an AgentTool that can spawn sub-agents sharing the same API client
 * and tool set. Each sub-agent gets its own message history and runs
 * independently until completion.
 */
export function createAgentTool(
  apiClient: APIClient,
  allTools: Tool[],
  contextProviders: ContextProvider[],
  canUseTool: CanUseToolFn,
): Tool<Input, AgentToolSuccessOutput> {
  return {
    name: 'Agent',
    aliases: ['AgentTool'],
    description: 'Spawn a sub-agent to handle a task independently. The sub-agent gets its own conversation context and can use tools. Use for parallelizable subtasks or isolated investigations.',

    inputSchema,

    isReadOnly() { return false },
    isConcurrencySafe() { return true },

    async checkPermissions(input): Promise<PermissionResult> {
      return {
        behavior: 'passthrough',
        message: `Spawn sub-agent: ${input.prompt.slice(0, 80)}`,
      }
    },

    async call(input, context, _canUseTool, _parentMessage, onProgress): Promise<ToolResult<AgentToolSuccessOutput>> {
      const agentId = uuidv4().slice(0, 8)

      // 未传 allowed_tools = 全量；传 [] = 无工具（纯生成）；有元素 = 白名单
      let agentTools: Tool[] = allTools
      if (input.allowed_tools !== undefined) {
        if (input.allowed_tools.length === 0) {
          agentTools = []
        } else {
          const allowed = new Set(input.allowed_tools)
          agentTools = allTools.filter(t => allowed.has(t.name))
        }
      }

      // 首轮若 messages 为空，仅带 system 调用 API，Gemini 等会报 contents is required
      const userTurn: Message = {
        role: 'user',
        content: input.prompt.trim() || '(empty task — please state the task.)',
      }

      // Create isolated state for sub-agent
      const agentState = {
        ...context.sessionState,
        sessionId: `${context.sessionState.sessionId}-agent-${agentId}`,
        messages: [userTurn] as Message[],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUSD: 0,
        modelUsage: new Map(),
        activeAgents: new Map(),
        systemPromptSectionCache: new Map(),
      }

      // Register in parent state
      const handle: AgentHandle = {
        id: agentId,
        status: 'running',
        messages: agentState.messages,
        onComplete: null as unknown as Promise<{ result: string; usage: Usage }>,
      }
      context.sessionState.activeAgents.set(agentId, handle)

      if (onProgress) {
        onProgress({
          toolUseID: `agent-${agentId}-start`,
          data: { type: 'agent_started', agentId, prompt: input.prompt.slice(0, 100) },
        })
      }

      // Run the sub-agent loop
      let resultText = ''
      let totalUsage: Usage = { inputTokens: 0, outputTokens: 0 }
      let turnCount = 0
      const eventCounts: Record<string, number> = {}
      const bump = (k: string) => {
        eventCounts[k] = (eventCounts[k] || 0) + 1
      }

      let lastStreamError: Error | undefined
      let lastMessageStopReason: string | undefined

      try {
        const providers = [...(contextProviders || []), dateContextProvider]

        logSubagentDebug(agentId, 'start', {
          model: agentState.model,
          toolsCount: agentTools.length,
          promptChars: input.prompt.length,
        })

        const loop = agentLoop({
          state: agentState,
          apiClient,
          tools: agentTools,
          contextProviders: providers,
          canUseTool,
          maxTurns: 20,
          signal: context.abortController.signal,
        })

        let loopFinal: AgentLoopResult | null = null
        for (;;) {
          const iterResult = await loop.next()
          if (iterResult.done) {
            loopFinal = iterResult.value
            turnCount = loopFinal.turnCount
            logSubagentDebug(agentId, 'generator done', {
              reason: loopFinal.reason,
              turnCount,
              eventCounts,
              resultTextLen: resultText.length,
            })
            break
          }

          const event = iterResult.value
          if (event.type === 'error') {
            lastStreamError = event.error instanceof Error ? event.error : new Error(String(event.error))
          }
          bump(event.type)
          if (event.type === 'text_delta') {
            const piece = event.text
            resultText += piece
            if (eventCounts.text_delta! <= 3 && piece) {
              logSubagentDebug(agentId, 'text_delta sample', { n: eventCounts.text_delta, preview: piece.slice(0, 80) })
            }
          } else if (event.type === 'thinking_delta') {
            const th = event.thinking
            resultText += th
            if (eventCounts.thinking_delta! <= 2 && th) {
              logSubagentDebug(agentId, 'thinking_delta sample', { n: eventCounts.thinking_delta, preview: th.slice(0, 80) })
            }
          } else if (
            ['tool_use_start', 'tool_result', 'message_end', 'message_start', 'error', 'turn_complete', 'tool_use_delta'].includes(
              event.type,
            )
          ) {
            logSubagentDebug(agentId, 'event', event.type, event)
          }
          if (event.type === 'message_end') {
            lastMessageStopReason = event.stopReason
            totalUsage = {
              inputTokens: totalUsage.inputTokens + event.usage.inputTokens,
              outputTokens: totalUsage.outputTokens + event.usage.outputTokens,
            }
          }

          if (onProgress) {
            onProgress({
              toolUseID: `agent-${agentId}-progress`,
              data: { type: 'agent_event', agentId, event },
            })
          }
        }

        if (!loopFinal) {
          throw new Error('Agent loop returned no final state')
        }
        if (loopFinal.reason !== 'completed') {
          if (loopFinal.reason === 'error' && lastStreamError) {
            throw lastStreamError
          }
          if (loopFinal.reason === 'max_turns') {
            throw new Error('Agent reached max turns (20) without completing')
          }
          if (loopFinal.reason === 'aborted') {
            throw new Error('Agent was aborted')
          }
          if (loopFinal.reason === 'prompt_too_long') {
            throw lastStreamError ?? new Error('Context too long')
          }
          throw lastStreamError ?? new Error(`Agent loop ended: ${loopFinal.reason}`)
        }

        handle.status = 'completed'

        // 将子 Agent 的 token 用量累加到父级 state（含成本）
        // 直接调用 accumulateUsage 以保持 modelUsage map 和 totalCostUSD 一致
        const { accumulateUsage } = await import('../../state/SessionState.js')
        accumulateUsage(context.sessionState, totalUsage, agentState.model)
      } catch (err) {
        handle.status = 'failed'
        const errMsg = err instanceof Error ? err.message : String(err)
        const failUsage: Usage = totalUsage
        putSubAgentSnapshot(context.sessionState, agentId, {
          agentId,
          status: 'failed',
          resultText: '',
          error: errMsg,
          workflowNodeId: context.workflowNodeId,
          messageSummary: buildMessageSummary(agentState.messages, 10),
          usage: {
            inputTokens: failUsage.inputTokens,
            outputTokens: failUsage.outputTokens,
            cacheReadTokens: failUsage.cacheReadTokens,
          },
          updatedAt: new Date().toISOString(),
        })
        if (err instanceof Error) throw err
        throw new Error(String(err))
      }

      // 与流式累积互补：从 state.messages 提取（含仅入库未经过 text_delta 的路径）
      if (!resultText.trim()) {
        logSubagentDebug(agentId, 'empty stream buffer; trying messages fallback', {
          messageCount: agentState.messages.length,
          roles: agentState.messages.map((m) => m.role),
        })
        const parts: string[] = []
        for (const msg of agentState.messages) {
          if (msg.role === 'assistant') {
            const t = extractTextFromAssistantMessage(msg)
            if (t) parts.push(t)
          }
        }
        resultText = parts.join('\n\n')
        if (!resultText.trim()) {
          const assistants = agentState.messages.filter((m) => m.role === 'assistant')
          logSubagentDebug(agentId, 'messages fallback still empty', {
            assistantBlocks: assistants.map((m, i) => ({
              i,
              contentPreview: typeof m.content === 'string'
                ? m.content.slice(0, 120)
                : m.content
                    .map((b) => (b.type === 'text' && 'text' in b ? b.text.slice(0, 120) : b.type))
                    .join(' | '),
            })),
          })
        } else {
          logSubagentDebug(agentId, 'messages fallback ok', { extractedLen: resultText.length })
        }
      }

      if (input.allowed_tools !== undefined && input.allowed_tools.length === 0) {
        resultText = stripBogusToolLikeText(resultText)
      }

      const trimmed = resultText.trim()
      const emptyOutput = trimmed.length === 0

      putSubAgentSnapshot(context.sessionState, agentId, {
        agentId,
        status: 'done',
        resultText: emptyOutput ? '' : resultText,
        ...(emptyOutput ? { emptyOutput: true as const } : {}),
        workflowNodeId: context.workflowNodeId,
        messageSummary: buildMessageSummary(agentState.messages, 10),
        usage: {
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          cacheReadTokens: totalUsage.cacheReadTokens,
        },
        updatedAt: new Date().toISOString(),
      })

      return {
        data: {
          agentId,
          result: emptyOutput ? '' : resultText,
          ...(emptyOutput ? { emptyOutput: true as const } : {}),
          stopReason: lastMessageStopReason,
          turnCount,
          usage: totalUsage,
        },
      }
    },

    mapToolResultToToolResultBlockParam(output, toolUseID) {
      // Emit task-notification XML for Coordinator mode consumption
      const displayResult = output.emptyOutput ? '' : output.result
      const preview = output.emptyOutput ? '[no text output]' : displayResult.slice(0, 200)
      const notification = buildTaskNotification(
        output.agentId,
        'completed',
        preview,
        displayResult,
        output.usage,
        output.turnCount,
        0, // duration tracked externally if needed
      )
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: notification,
      }
    },
  }
}
