/**
 * MCP 资源适配 — MCP 资源列表/读取适配器
 *
 * 将 SDK 返回的 Resource 规范为 MCPResourceInfo（含服务器名），并提供按 URI
 * readResource、合并多段文本与二进制占位说明的读取能力。
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Resource } from '@modelcontextprotocol/sdk/types.js'

export interface MCPResourceInfo {
  uri: string
  name: string
  description?: string
  mimeType?: string
  serverName: string
}

export function listMCPResources(
  serverName: string,
  resources: Resource[],
): MCPResourceInfo[] {
  return resources.map(r => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
    serverName,
  }))
}

export async function readMCPResource(
  client: Client,
  uri: string,
): Promise<{ content: string; mimeType?: string }> {
  const result = await client.readResource({ uri })

  const contents = result.contents || []
  const textParts = contents.map((c: { text?: string; uri: string; mimeType?: string }) =>
    c.text || `[Binary content at ${c.uri}]`,
  )

  return {
    content: textParts.join('\n'),
    mimeType: contents[0]?.mimeType,
  }
}
