/**
 * MCP 客户端 — MCP 客户端管理器（stdio + HTTP 传输，连接生命周期）
 *
 * 基于官方 SDK 与 stdio 或 HTTP 流式传输连接各 MCP 服务器，列举工具与资源，
 * 按名称缓存连接并在断开时清理传输与客户端状态。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool as MCPToolDef, Resource } from '@modelcontextprotocol/sdk/types.js'
import type { MCPServerConfig, Tool } from '../types.js'

export interface MCPConnection {
  name: string
  client: Client
  transport: StdioClientTransport | HTTPStreamTransport
  tools: MCPToolDef[]
  resources: Resource[]
  status: 'connected' | 'disconnected' | 'error'
}

interface HTTPStreamTransport {
  close(): Promise<void>
}

export class MCPClientManager {
  private connections = new Map<string, MCPConnection>()

  async connect(config: MCPServerConfig): Promise<MCPConnection> {
    const existing = this.connections.get(config.name)
    if (existing?.status === 'connected') return existing

    if (config.transport === 'stdio') {
      return this.connectStdio(config)
    } else if (config.transport === 'http') {
      return this.connectHTTP(config)
    }

    throw new Error(`Unsupported MCP transport: ${config.transport}`)
  }

  private async connectStdio(config: MCPServerConfig): Promise<MCPConnection> {
    if (!config.command) throw new Error('MCP stdio transport requires "command"')

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    })

    const client = new Client(
      { name: '/lumi', version: '0.1.0' },
      { capabilities: {} },
    )

    await client.connect(transport)

    // Discover tools and resources
    let tools: MCPToolDef[] = []
    let resources: Resource[] = []

    try {
      const toolsResult = await client.listTools()
      tools = toolsResult.tools || []
    } catch { /* Server may not support tools */ }

    try {
      const resourcesResult = await client.listResources()
      resources = resourcesResult.resources || []
    } catch { /* Server may not support resources */ }

    const connection: MCPConnection = {
      name: config.name,
      client,
      transport,
      tools,
      resources,
      status: 'connected',
    }

    this.connections.set(config.name, connection)
    return connection
  }

  private async connectHTTP(config: MCPServerConfig): Promise<MCPConnection> {
    if (!config.url) throw new Error('MCP HTTP transport requires "url"')

    // HTTP Streamable transport via fetch-based approach
    // For now, use the SDK's SSE transport as HTTP streamable fallback
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')

    const transport = new SSEClientTransport(new URL(config.url))

    const client = new Client(
      { name: '/lumi', version: '0.1.0' },
      { capabilities: {} },
    )

    await client.connect(transport)

    let tools: MCPToolDef[] = []
    let resources: Resource[] = []

    try {
      const toolsResult = await client.listTools()
      tools = toolsResult.tools || []
    } catch {}

    try {
      const resourcesResult = await client.listResources()
      resources = resourcesResult.resources || []
    } catch {}

    const connection: MCPConnection = {
      name: config.name,
      client,
      transport: transport as unknown as HTTPStreamTransport,
      tools,
      resources,
      status: 'connected',
    }

    this.connections.set(config.name, connection)
    return connection
  }

  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name)
    if (!conn) return

    try {
      await conn.client.close()
      await conn.transport.close()
    } catch { /* ignore cleanup errors */ }

    conn.status = 'disconnected'
    this.connections.delete(name)
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.connections.keys()]
    await Promise.allSettled(names.map(n => this.disconnect(n)))
  }

  getConnection(name: string): MCPConnection | undefined {
    return this.connections.get(name)
  }

  getAllConnections(): MCPConnection[] {
    return [...this.connections.values()]
  }

  getConnectedNames(): string[] {
    return [...this.connections.entries()]
      .filter(([, c]) => c.status === 'connected')
      .map(([name]) => name)
  }
}
