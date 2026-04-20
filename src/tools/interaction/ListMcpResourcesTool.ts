/**
 * ListMcpResourcesTool — 列出 MCP 服务器资源
 *
 * 枚举已连接 MCP 服务器暴露的资源（可指定 server 或全部），返回 URI、名称与 MIME 等元数据。
 * 通过 ToolContext.mcpManager 访问真实连接。
 */

import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'
import type { MCPConnection } from '../../mcp/client.js'
import type { Resource } from '@modelcontextprotocol/sdk/types.js'

const inputSchema = z.object({
  server: z.string().optional().describe('MCP server name to list resources from (default: all connected servers)'),
})

type Input = z.infer<typeof inputSchema>

interface ResourceInfo {
  uri: string
  name: string
  description?: string
  mimeType?: string
  server: string
}

interface Output {
  resources: ResourceInfo[]
  count: number
}

export const ListMcpResourcesTool: Tool<Input, Output> = {
  name: 'ListMcpResources',
  aliases: ['ListMcpResourcesTool'],
  description: 'List available resources from connected MCP servers. Use to discover data sources like databases, files, or APIs exposed via MCP.',

  inputSchema,
  shouldDefer: true,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const mcpManager = context.mcpManager
    if (!mcpManager) {
      return {
        data: { resources: [], count: 0 },
        metadata: { error: 'No MCP servers connected. Configure mcpServers in .blino/settings.json.' },
      }
    }

    const connections = mcpManager.getAllConnections() as MCPConnection[]
    const resources: ResourceInfo[] = []

    for (const conn of connections) {
      if (conn.status !== 'connected') continue
      if (input.server && conn.name !== input.server) continue

      for (const res of conn.resources as Resource[]) {
        resources.push({
          uri: res.uri,
          name: res.name,
          description: res.description,
          mimeType: res.mimeType,
          server: conn.name,
        })
      }
    }

    return { data: { resources, count: resources.length } }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.count === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No MCP resources found. Make sure MCP servers are connected and expose resources.',
      }
    }

    const lines = output.resources.map(r =>
      `- **${r.name}** [${r.server}]: \`${r.uri}\`${r.description ? ` — ${r.description}` : ''}${r.mimeType ? ` (${r.mimeType})` : ''}`
    )

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `MCP Resources (${output.count}):\n${lines.join('\n')}`,
    }
  },
}
