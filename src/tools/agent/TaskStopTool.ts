/**
 * TaskStopTool — 停止运行中的 Agent
 *
 * 按 `agent_id` 终止正在执行的子 Agent，适用于任务取消或超时等场景。
 */
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  agent_id: z.string().describe('The ID of the agent to stop'),
  reason: z.string().optional().describe('Reason for stopping the agent'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  agentId: string
  stopped: boolean
  message: string
}

export const TaskStopTool: Tool<Input, Output> = {
  name: 'TaskStop',
  aliases: ['TaskStopTool'],
  description: 'Stop a running sub-agent. Use when a task is no longer needed or taking too long.',

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
          stopped: false,
          message: `Agent "${input.agent_id}" not found.`,
        },
      }
    }

    if (handle.status !== 'running') {
      return {
        data: {
          agentId: input.agent_id,
          stopped: false,
          message: `Agent "${input.agent_id}" is already ${handle.status}.`,
        },
      }
    }

    handle.status = 'killed'

    return {
      data: {
        agentId: input.agent_id,
        stopped: true,
        message: `Agent ${input.agent_id} stopped.${input.reason ? ` Reason: ${input.reason}` : ''}`,
      },
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.message,
      is_error: !output.stopped,
    }
  },
}
