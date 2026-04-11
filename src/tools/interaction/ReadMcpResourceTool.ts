/**
 * ReadMcpResourceTool — 读取 MCP 服务器上的特定资源
 *
 * 根据服务器名与资源 URI 拉取 MCP 资源正文（及可选 MIME），用于将外部资源读入对话上下文。
 * 通过 ToolContext.mcpManager 访问真实连接。
 */

import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'
import type { MCPConnection } from '../../mcp/client.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

const inputSchema = z.object({
  server: z.string().describe('MCP server name'),
  uri: z.string().describe('Resource URI to read (get from ListMcpResources first)'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  uri: string
  server: string
  content: string
  mimeType?: string
  success: boolean
}

export const ReadMcpResourceTool: Tool<Input, Output> = {
  name: 'ReadMcpResource',
  aliases: ['ReadMcpResourceTool'],
  description: 'Read content from a specific MCP resource by URI. Use ListMcpResources first to discover available URIs.',

  inputSchema,
  shouldDefer: true,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(input): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: `Read MCP resource: ${input.uri} from ${input.server}`,
    }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const mcpManager = context.mcpManager
    if (!mcpManager) {
      return {
        data: { uri: input.uri, server: input.server, content: 'No MCP manager available.', success: false },
      }
    }

    const connections = mcpManager.getAllConnections() as MCPConnection[]
    const conn = connections.find(c => c.name === input.server && c.status === 'connected')

    if (!conn) {
      return {
        data: {
          uri: input.uri,
          server: input.server,
          content: `Server "${input.server}" not found or not connected. Use ListMcpResources to see available servers.`,
          success: false,
        },
      }
    }

    try {
      const client = conn.client as Client
      const result = await client.readResource({ uri: input.uri })

      const contents = result.contents || []
      const textParts = contents.map((c: { text?: string; uri: string; mimeType?: string }) =>
        c.text || `[Binary content at ${c.uri}]`
      )
      const mimeType = contents[0]?.mimeType

      return {
        data: {
          uri: input.uri,
          server: input.server,
          content: textParts.join('\n'),
          mimeType,
          success: true,
        },
      }
    } catch (err) {
      return {
        data: {
          uri: input.uri,
          server: input.server,
          content: `Error reading resource: ${(err as Error).message}`,
          success: false,
        },
      }
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const header = `Resource: ${output.uri} (${output.server}${output.mimeType ? `, ${output.mimeType}` : ''})`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.success ? `${header}\n\n${output.content}` : `Error: ${output.content}`,
      is_error: !output.success,
    }
  },
}
