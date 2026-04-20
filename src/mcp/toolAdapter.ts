/**
 * MCP 工具适配 — MCP 工具 → 内部 Tool 接口适配器
 *
 * 将远端 MCP 工具定义包装为本项目的 Tool：JSON Schema 转 Zod、权限钩子、
 * 通过 Client 调用 execute；工具名使用 mcp__<server>__<tool> 命名空间。
 */
import { z } from 'zod'
import type { Tool as MCPToolDef } from '@modelcontextprotocol/sdk/types.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { PermissionResult, Tool, ToolResult } from '../types.js'

/**
 * Wrap MCP tools as /blino Tool interface.
 * Tool names are namespaced: mcp__<serverName>__<toolName>
 */
export function adaptMCPTools(
  serverName: string,
  mcpTools: MCPToolDef[],
  client: Client,
): Tool[] {
  return mcpTools.map(mcpTool => createMCPToolWrapper(serverName, mcpTool, client))
}

function createMCPToolWrapper(
  serverName: string,
  mcpTool: MCPToolDef,
  client: Client,
): Tool {
  const fullName = `mcp__${serverName}__${mcpTool.name}`

  const inputSchema = mcpTool.inputSchema
    ? jsonSchemaToZod(mcpTool.inputSchema as Record<string, unknown>)
    : z.object({})

  return {
    name: fullName,
    description: mcpTool.description || `MCP tool: ${mcpTool.name} (from ${serverName})`,
    inputSchema,

    shouldDefer: true,
    isMcp: true,

    isReadOnly() { return false },
    isConcurrencySafe() { return true },

    async checkPermissions(input): Promise<PermissionResult> {
      return {
        behavior: 'passthrough',
        message: `Allow MCP tool ${mcpTool.name} from ${serverName}`,
        suggestions: [{
          type: 'addRules',
          rules: [{ toolName: fullName }],
          behavior: 'allow',
          destination: 'session',
        }],
      }
    },

    async call(input, context): Promise<ToolResult> {
      try {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: input as Record<string, unknown>,
        })

        const content = Array.isArray(result.content)
          ? result.content
              .map((c: { type: string; text?: string }) =>
                c.type === 'text' ? c.text : JSON.stringify(c),
              )
              .join('\n')
          : String(result.content)

        return {
          data: content,
          metadata: { isError: result.isError },
        }
      } catch (err) {
        return {
          data: `MCP tool error: ${(err as Error).message}`,
          metadata: { isError: true },
        }
      }
    },

    mapToolResultToToolResultBlockParam(output, toolUseID) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: typeof output === 'string' ? output : JSON.stringify(output),
        is_error: false,
      }
    },
  } as Tool & { isMcp: boolean }
}

/**
 * Minimal JSON Schema → Zod converter for MCP tool input schemas.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  if (!schema || schema.type !== 'object') {
    return z.record(z.unknown())
  }

  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>
  const required = new Set((schema.required || []) as string[])

  const shape: Record<string, z.ZodType> = {}

  for (const [key, prop] of Object.entries(properties)) {
    let field = jsonSchemaPropertyToZod(prop)
    if (!required.has(key)) {
      field = field.optional()
    }
    shape[key] = field
  }

  return z.object(shape)
}

function jsonSchemaPropertyToZod(prop: Record<string, unknown>): z.ZodType {
  const desc = prop.description as string | undefined

  switch (prop.type) {
    case 'string': {
      let s = z.string()
      if (desc) s = s.describe(desc)
      if (prop.enum) return z.enum(prop.enum as [string, ...string[]])
      return s
    }
    case 'number':
    case 'integer': {
      let n = z.number()
      if (desc) n = n.describe(desc)
      return n
    }
    case 'boolean': {
      let b = z.boolean()
      if (desc) b = b.describe(desc)
      return b
    }
    case 'array':
      return z.array(
        prop.items ? jsonSchemaPropertyToZod(prop.items as Record<string, unknown>) : z.unknown(),
      )
    case 'object':
      return jsonSchemaToZod(prop)
    default:
      return z.unknown()
  }
}
