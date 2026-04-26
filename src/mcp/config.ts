/**
 * MCP 配置 — MCP 三级配置合并（user/project/local）
 *
 * 依次读取用户目录、项目根与本地（通常不提交）下的 settings.json，合并 mcpServers；
 * 后读覆盖先读（local > project > user），并归一化为运行时可用的 MCPServerConfig。
 */
import { readFile } from 'node:fs/promises'
import type { MCPServerConfig } from '../types.js'
import { BLINO_CONFIG_FILE, resolveProjectBlinoPath, resolveUserBlinoPath, getUserHomeDir } from '../constants/blinoPaths.js'

interface MCPConfigFile {
  mcpServers?: Record<string, MCPServerConfigRaw>
}

interface MCPServerConfigRaw {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  transport?: 'stdio' | 'http'
}

/**
 * Load and merge MCP configs from three levels:
 *   1. User-level:   <用户主目录>/.blino/settings.json
 *   2. Project-level: <项目>/.blino/settings.json
 *   3. Local-level:   <项目>/.blino/settings.local.json (not committed)
 *
 * Later levels override earlier ones (local > project > user).
 */
export async function loadMCPConfigs(
  projectRoot: string,
): Promise<MCPServerConfig[]> {
  const homeDir = getUserHomeDir()

  const configPaths = [
    homeDir ? resolveUserBlinoPath(BLINO_CONFIG_FILE.settings) : null,
    resolveProjectBlinoPath(projectRoot, BLINO_CONFIG_FILE.settings),
    resolveProjectBlinoPath(projectRoot, BLINO_CONFIG_FILE.settingsLocal),
  ].filter(Boolean) as string[]

  const merged: Record<string, MCPServerConfigRaw> = {}

  for (const configPath of configPaths) {
    try {
      const raw = await readFile(configPath, 'utf-8')
      const parsed: MCPConfigFile = JSON.parse(raw)

      if (parsed.mcpServers) {
        for (const [name, config] of Object.entries(parsed.mcpServers)) {
          merged[name] = { ...(merged[name] || {}), ...config }
        }
      }
    } catch {
      // File not found or invalid JSON — skip
    }
  }

  return Object.entries(merged).map(([name, raw]) => ({
    name,
    transport: raw.transport || (raw.url ? 'http' : 'stdio'),
    command: raw.command,
    args: raw.args,
    env: expandEnvVars(raw.env),
    url: raw.url,
  }))
}

/**
 * Expand ${VAR} references in env values.
 */
function expandEnvVars(
  env?: Record<string, string>,
): Record<string, string> | undefined {
  if (!env) return undefined

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(/\$\{(\w+)\}/g, (_, varName) =>
      process.env[varName] || '',
    )
  }
  return result
}
