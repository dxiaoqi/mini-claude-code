/**
 * tools/ToolSearchTool.ts — 工具搜索
 *
 * 按查询匹配工具，可发现 deferred 工具并返回完整 inputSchema（JSON Schema）。
 */
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../types.js'
import { zodToJsonSchema } from '../utils/zodToJsonSchema.js'

const inputSchema = z.object({
  query: z.string().describe('Search query describing the tool capability you need'),
})

type Input = z.infer<typeof inputSchema>

interface ToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

interface Output {
  query: string
  tools: ToolInfo[]
  count: number
}

/**
 * Creates a ToolSearchTool that can search through deferred tools.
 * The tool list is injected at creation time so it has access to all registered tools.
 */
export function createToolSearchTool(allTools: Tool[]): Tool<Input, Output> {
  return {
    name: 'ToolSearch',
    aliases: ['ToolSearchTool'],
    description: 'Search for available tools by capability description. Use this to discover tools that are not loaded by default.',

    inputSchema,
    alwaysLoad: true,

    isReadOnly() { return true },
    isConcurrencySafe() { return true },

    async checkPermissions(): Promise<PermissionResult> {
      return { behavior: 'allow' }
    },

    async call(input): Promise<ToolResult<Output>> {
      const query = input.query.toLowerCase()
      const keywords = query.split(/\s+/)

      const scored = allTools.map(tool => {
        const name = tool.name.toLowerCase()
        const desc = (typeof tool.description === 'string' ? tool.description : tool.name).toLowerCase()
        const aliases = (tool.aliases || []).map(a => a.toLowerCase())

        let score = 0
        for (const kw of keywords) {
          if (name.includes(kw)) score += 3
          if (aliases.some(a => a.includes(kw))) score += 2
          if (desc.includes(kw)) score += 1
        }

        return { tool, score }
      })

      const matched = scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(s => ({
          name: s.tool.name,
          description: typeof s.tool.description === 'string' ? s.tool.description : s.tool.name,
          inputSchema: zodToJsonSchema(s.tool.inputSchema),
        }))

      return {
        data: {
          query: input.query,
          tools: matched,
          count: matched.length,
        },
      }
    },

    mapToolResultToToolResultBlockParam(output, toolUseID) {
      if (output.count === 0) {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `No tools found matching: "${output.query}"`,
        }
      }

      const lines = output.tools.map(t =>
        `**${t.name}**: ${t.description}\nParameters: ${JSON.stringify(t.inputSchema, null, 2)}`
      )

      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Found ${output.count} tool(s) for "${output.query}":\n\n${lines.join('\n\n')}`,
      }
    },
  }
}
