/**
 * AskUserTool — 向用户提问并等待回答的工具
 *
 * 发起澄清或选项式提问；交互由 ToolContext 回调与适配器实现（管道模式下无交互则返回占位结果）。
 */
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  question: z.string().describe('The question to ask the user'),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
  })).optional().describe('Optional multiple-choice options'),
  allow_multiple: z.boolean().optional().describe('If true, user can select multiple options'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  question: string
  answer: string
  selectedOptions?: string[]
}

/**
 * AskUserTool — asks the user a question and waits for their response.
 * In pipe mode, this returns a placeholder since there's no interactive input.
 * In REPL mode, the adapter handles prompting the user.
 *
 * The actual user interaction is handled via a callback set on the ToolContext.
 */
export const AskUserTool: Tool<Input, Output> = {
  name: 'AskUser',
  aliases: ['AskUserTool', 'AskUserQuestionTool'],
  description: 'Ask the user a question and wait for their response. Use when you need clarification or user input to proceed.',

  inputSchema,

  isReadOnly() { return true },
  isConcurrencySafe() { return false },

  interruptBehavior() { return 'cancel' },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    // Check if we have an interactive way to ask
    const askFn = (context as unknown as { askUser?: (q: string, opts?: unknown) => Promise<string> }).askUser

    if (!askFn) {
      // Non-interactive mode — return the question as the answer prompt
      return {
        data: {
          question: input.question,
          answer: '[Non-interactive mode — unable to ask user. Please rephrase as a statement or make a reasonable assumption.]',
        },
      }
    }

    try {
      const answer = await askFn(input.question, input.options)
      return {
        data: {
          question: input.question,
          answer,
        },
      }
    } catch {
      return {
        data: {
          question: input.question,
          answer: '[User did not respond]',
        },
      }
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Question: ${output.question}\nUser answer: ${output.answer}`,
    }
  },
}
