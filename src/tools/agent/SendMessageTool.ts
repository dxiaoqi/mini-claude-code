/**
 * SendMessageTool — 向已有 Agent 发送后续消息
 *
 * 根据 `agent_id` 将补充说明或追问投递给仍在会话中的子 Agent，用于延续同一子任务。
 */
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult, AgentHandle } from '../../types.js'

const inputSchema = z.object({
  agent_id: z.string().describe('The ID of the agent to send a message to'),
  message: z.string().describe('The follow-up message to send'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  agentId: string
  delivered: boolean
  message: string
}

export const SendMessageTool: Tool<Input, Output> = {
  name: 'SendMessage',
  aliases: ['SendMessageTool'],
  description: 'Send a follow-up message to an existing sub-agent. Use to provide additional instructions or continue a task.',

  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return true },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const handle = context.sessionState.activeAgents.get(input.agent_id)

    if (!handle) {
      return {
        data: {
          agentId: input.agent_id,
          delivered: false,
          message: `Agent "${input.agent_id}" not found. Active agents: ${[...context.sessionState.activeAgents.keys()].join(', ') || 'none'}`,
        },
      }
    }

    if (handle.status !== 'running' && handle.status !== 'completed') {
      return {
        data: {
          agentId: input.agent_id,
          delivered: false,
          message: `Agent "${input.agent_id}" is ${handle.status} and cannot receive messages.`,
        },
      }
    }

    // Append message to agent's conversation
    handle.messages.push({
      role: 'user',
      content: input.message,
    })

    return {
      data: {
        agentId: input.agent_id,
        delivered: true,
        message: `Message delivered to agent ${input.agent_id}`,
      },
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.message,
      is_error: !output.delivered,
    }
  },
}
