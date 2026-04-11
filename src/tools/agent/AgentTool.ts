/**
 * AgentTool — 子 Agent 派生工具
 *
 * 通过工厂函数创建可派生子 Agent 的工具：子任务在独立消息上下文中运行，与主会话隔离直至结束。
 */
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { buildTaskNotification } from '../../engine/coordinator/coordinatorMode.js'
import type {
  AgentHandle,
  APIClient,
  AssistantMessage,
  CanUseToolFn,
  ContentBlock,
  ContextProvider,
  Message,
  PermissionResult,
  StreamEvent,
  Tool,
  ToolContext,
  ToolResult,
  Usage,
} from '../../types.js'
import { agentLoop } from '../../engine/agentLoop.js'
import { buildSystemPrompt } from '../../context/systemPrompt.js'
import { dateContextProvider } from '../../context/providers/dateContext.js'

const inputSchema = z.object({
  prompt: z.string().describe('The task description for the sub-agent'),
  allowed_tools: z.array(z.string()).optional().describe('Restrict the sub-agent to these tools (default: all)'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  agentId: string
  result: string
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
): Tool<Input, Output> {
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

    async call(input, context, _canUseTool, _parentMessage, onProgress): Promise<ToolResult<Output>> {
      const agentId = uuidv4().slice(0, 8)

      // Filter tools if allowed_tools specified
      let agentTools = allTools
      if (input.allowed_tools && input.allowed_tools.length > 0) {
        const allowed = new Set(input.allowed_tools)
        agentTools = allTools.filter(t => allowed.has(t.name))
      }

      // Create isolated state for sub-agent
      const agentState = {
        ...context.sessionState,
        sessionId: `${context.sessionState.sessionId}-agent-${agentId}`,
        messages: [] as Message[],
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

      try {
        const providers = [...(contextProviders || []), dateContextProvider]

        const loop = agentLoop({
          state: agentState,
          apiClient,
          tools: agentTools,
          contextProviders: providers,
          canUseTool,
          maxTurns: 20,
          signal: context.abortController.signal,
        })

        for (;;) {
          const iterResult = await loop.next()
          if (iterResult.done) {
            turnCount = iterResult.value.turnCount
            break
          }

          const event = iterResult.value

          if (event.type === 'text_delta') {
            resultText += event.text
          }
          if (event.type === 'message_end') {
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

        handle.status = 'completed'

        // 将子 Agent 的 token 用量累加到父级 state（含成本）
        // 直接调用 accumulateUsage 以保持 modelUsage map 和 totalCostUSD 一致
        const { accumulateUsage } = await import('../../state/SessionState.js')
        accumulateUsage(context.sessionState, totalUsage, agentState.model)
      } catch (err) {
        handle.status = 'failed'
        resultText = `Agent error: ${(err as Error).message}`
      }

      // Extract final assistant text from sub-agent messages
      if (!resultText) {
        for (let i = agentState.messages.length - 1; i >= 0; i--) {
          const msg = agentState.messages[i]
          if (msg.role === 'assistant') {
            if (typeof msg.content === 'string') {
              resultText = msg.content
            } else {
              resultText = (msg.content as ContentBlock[])
                .filter(b => b.type === 'text')
                .map(b => (b as { text: string }).text)
                .join('\n')
            }
            if (resultText) break
          }
        }
      }

      return {
        data: {
          agentId,
          result: resultText || '[Agent completed with no text output]',
          turnCount,
          usage: totalUsage,
        },
      }
    },

    mapToolResultToToolResultBlockParam(output, toolUseID) {
      // Emit task-notification XML for Coordinator mode consumption
      const notification = buildTaskNotification(
        output.agentId,
        'completed',
        output.result.slice(0, 200),
        output.result,
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
