/**
 * TaskOutputTool — 获取 Agent 当前输出和状态
 *
 * 查询指定子 Agent 的运行状态、消息数量及最近输出摘要，用于轮询子任务进度。
 */
import { z } from 'zod'
import type { ContentBlock, PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  agent_id: z.string().describe('The ID of the agent to get output from'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  agentId: string
  status: string
  messageCount: number
  lastOutput: string
  found: boolean
}

export const TaskOutputTool: Tool<Input, Output> = {
  name: 'TaskOutput',
  aliases: ['TaskOutputTool'],
  description: 'Get the current output and status of a sub-agent.',

  inputSchema,

  isReadOnly() { return true },
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
          status: 'not_found',
          messageCount: 0,
          lastOutput: `Agent "${input.agent_id}" not found.`,
          found: false,
        },
      }
    }

    let lastOutput = ''
    for (let i = handle.messages.length - 1; i >= 0; i--) {
      const msg = handle.messages[i]
      if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          lastOutput = msg.content
        } else {
          lastOutput = (msg.content as ContentBlock[])
            .filter(b => b.type === 'text')
            .map(b => (b as { text: string }).text)
            .join('\n')
        }
        if (lastOutput) break
      }
    }

    return {
      data: {
        agentId: input.agent_id,
        status: handle.status,
        messageCount: handle.messages.length,
        lastOutput: lastOutput || '[No output yet]',
        found: true,
      },
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const header = `Agent ${output.agentId} [${output.status}] (${output.messageCount} messages)`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${header}\n\n${output.lastOutput}`,
      is_error: !output.found,
    }
  },
}
