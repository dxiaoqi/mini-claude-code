/**
 * TodoWriteTool — TODO 任务列表管理工具
 *
 * 在当前会话中维护结构化待办列表，支持按 id 合并更新或整体替换，用于多步骤任务进度跟踪。
 */
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const todoItemSchema = z.object({
  id: z.string().describe('Unique identifier for the TODO item'),
  content: z.string().describe('Description of the TODO item'),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('Current status'),
})

const inputSchema = z.object({
  todos: z.array(todoItemSchema).describe('Array of TODO items to create or update'),
  merge: z.boolean().optional().describe('If true, merge with existing todos by id; if false, replace all'),
})

type Input = z.infer<typeof inputSchema>
type TodoItem = z.infer<typeof todoItemSchema>

interface Output {
  todos: TodoItem[]
  count: number
}

let currentTodos: TodoItem[] = []

export const TodoWriteTool: Tool<Input, Output> = {
  name: 'TodoWrite',
  aliases: ['TodoWriteTool'],
  description: 'Create and manage a structured task list for the current session. Use for tracking progress on multi-step tasks.',

  inputSchema,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  async call(input): Promise<ToolResult<Output>> {
    if (input.merge) {
      const idMap = new Map(currentTodos.map(t => [t.id, t]))
      for (const todo of input.todos) {
        idMap.set(todo.id, { ...idMap.get(todo.id), ...todo })
      }
      currentTodos = [...idMap.values()]
    } else {
      currentTodos = [...input.todos]
    }

    return {
      data: {
        todos: currentTodos,
        count: currentTodos.length,
      },
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.count === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'TODO list is empty.',
      }
    }

    const statusIcons: Record<string, string> = {
      pending: '○',
      in_progress: '◉',
      completed: '✓',
      cancelled: '✗',
    }

    const lines = output.todos.map(t =>
      `${statusIcons[t.status] || '?'} [${t.status}] ${t.content} (${t.id})`
    )

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `TODO list (${output.count} items):\n${lines.join('\n')}`,
    }
  },
}

export function getCurrentTodos(): readonly TodoItem[] {
  return currentTodos
}

export function clearTodos(): void {
  currentTodos = []
}
