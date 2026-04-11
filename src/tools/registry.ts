/**
 * tools/registry.ts — 工具注册表
 *
 * 注册与查找工具、转换为 API tool schema，并支持 deferred 延迟加载类工具。
 */
import type { Tool, APIToolSchema } from '../types.js'
import { zodToJsonSchema } from '../utils/zodToJsonSchema.js'

const toolRegistry: Tool[] = []

export function registerTool(tool: Tool): void {
  toolRegistry.push(tool)
}

export function getAllTools(): Tool[] {
  return toolRegistry.filter(t => !t.isEnabled || t.isEnabled())
}

export function findToolByName(name: string, tools?: Tool[]): Tool | undefined {
  const pool = tools || toolRegistry
  return pool.find(t => {
    if (t.name === name) return true
    if (t.aliases?.includes(name)) return true
    return false
  })
}

export function toolToAPISchema(tool: Tool): APIToolSchema {
  const desc = typeof tool.description === 'string'
    ? tool.description
    : tool.name

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: desc,
      parameters: zodToJsonSchema(tool.inputSchema),
    },
    deferLoading: tool.shouldDefer,
  }
}

export function getAPIToolSchemas(tools: Tool[]): APIToolSchema[] {
  return tools.map(toolToAPISchema)
}
