/**
 * utils/config.ts — 分级配置
 *
 * 读写三级 JSON 配置，合并优先级与权限规则持久化。
 * 配置文件路径（与 Claude Code 对齐）：
 *
 *   全局级: ~/.blino/settings.json        (用户目录，跨项目)
 *   项目级: .blino/settings.json          (提交到 git，团队共享)
 *   本地级: .blino/settings.local.json    (不提交，覆盖项目配置)
 *
 * API Key 配置示例：
 *   ~/.blino/settings.json
 *   {
 *     "api": {
 *       "provider": "anthropic",
 *       "anthropicApiKey": "sk-ant-...",
 *       "anthropicBaseUrl": "https://api.anthropic.com",
 *       "model": "claude-sonnet-4-20250514"
 *     }
 *   }
 *
 * 优先级（高 → 低）：
 *   CLI 参数 > 环境变量 > 本地配置 > 项目配置 > 全局配置
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import type { PermissionRule, Settings } from '../types.js'

// ── 路径 ──

export function getUserConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
  return resolve(home, '.blino', 'settings.json')
}

export function getProjectConfigPath(projectRoot: string): string {
  return resolve(projectRoot, '.blino', 'settings.json')
}

export function getLocalConfigPath(projectRoot: string): string {
  return resolve(projectRoot, '.blino', 'settings.local.json')
}

// ── API Key 配置结构 ──

export interface ApiConfig {
  /** 'anthropic' | 'openai' */
  provider?: string
  /** Anthropic API Key */
  anthropicApiKey?: string
  /** Anthropic Base URL（用于中转/兼容接口） */
  anthropicBaseUrl?: string
  /** OpenAI Compatible API Key */
  openaiApiKey?: string
  /** OpenAI Compatible Base URL */
  openaiBaseUrl?: string
  /** 默认模型 */
  model?: string
  /** 备用模型（主模型失败时切换） */
  fallbackModel?: string
  /** Tavily API Key（WebSearch fallback，OpenAI provider 时使用） */
  tavilyApiKey?: string
}

// ── 加载 ──

/**
 * 从三级配置文件加载并合并 Settings。
 * 优先级：本地 > 项目 > 全局。
 */
export async function loadSettings(projectRoot: string): Promise<Settings> {
  const paths = [
    getUserConfigPath(),
    getProjectConfigPath(projectRoot),
    getLocalConfigPath(projectRoot),
  ]

  let merged: Record<string, unknown> = {}

  for (const path of paths) {
    try {
      const raw = await readFile(path, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      merged = deepMerge(merged, parsed)
    } catch {
      // 文件不存在或 JSON 格式错误 → 跳过
    }
  }

  return merged as unknown as Settings
}

/**
 * 解析并合并 API 配置：配置文件 → 环境变量 → CLI 参数（后者覆盖前者）
 *
 * 解析优先级（高 → 低）：
 *   1. CLI 参数（apiKey / baseUrl / model）
 *   2. 环境变量（ANTHROPIC_API_KEY / OPENAI_API_KEY 等）
 *   3. 配置文件 local > project > global
 */
export async function resolveApiConfig(
  projectRoot: string,
  cliOverrides?: {
    apiKey?: string
    baseUrl?: string
    model?: string
    provider?: string
  },
): Promise<{
  provider: 'anthropic' | 'openai'
  apiKey: string
  baseUrl: string
  model: string
  fallbackModel?: string
}> {
  const settings = await loadSettings(projectRoot)
  const cfg = (settings.api || {}) as ApiConfig

  // 1. 从配置文件解析基础值
  let provider = cfg.provider || 'openai'
  let apiKey = ''
  let baseUrl = ''
  let model = cfg.model || ''
  const fallbackModel = cliOverrides?.model ? undefined : cfg.fallbackModel

  if (provider === 'anthropic') {
    apiKey = cfg.anthropicApiKey || ''
    baseUrl = cfg.anthropicBaseUrl || 'https://api.anthropic.com'
  } else {
    apiKey = cfg.openaiApiKey || ''
    baseUrl = cfg.openaiBaseUrl || ''
  }

  // 2. 环境变量覆盖（区分 Anthropic / OpenAI）
  const hasAnthropicEnv = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_BASE_URL)
  const hasOpenAIEnv = !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL)

  if (hasAnthropicEnv && !hasOpenAIEnv) {
    provider = 'anthropic'
    apiKey = process.env.ANTHROPIC_API_KEY || apiKey
    baseUrl = process.env.ANTHROPIC_BASE_URL || baseUrl || 'https://api.anthropic.com'
  } else if (hasOpenAIEnv) {
    provider = 'openai'
    apiKey = process.env.OPENAI_API_KEY || apiKey
    baseUrl = process.env.OPENAI_BASE_URL || baseUrl
  } else if (process.env.API_KEY) {
    apiKey = process.env.API_KEY
  }

  if (process.env.MODEL) model = process.env.MODEL
  if (process.env.API_BASE_URL) baseUrl = process.env.API_BASE_URL

  // 3. CLI 参数最优先
  if (cliOverrides?.provider) provider = cliOverrides.provider
  if (cliOverrides?.apiKey) apiKey = cliOverrides.apiKey
  if (cliOverrides?.baseUrl) baseUrl = cliOverrides.baseUrl
  if (cliOverrides?.model) model = cliOverrides.model

  // 默认模型
  if (!model) {
    model = provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'
  }

  return {
    provider: provider as 'anthropic' | 'openai',
    apiKey,
    baseUrl,
    model,
    fallbackModel,
  }
}

// ── 写入 ──

/**
 * 保存 API 配置到指定级别的 settings.json。
 * level = 'user' → 全局，'project' → 项目级，'local' → 本地级
 */
export async function saveApiConfig(
  level: 'user' | 'project' | 'local',
  projectRoot: string,
  cfg: Partial<ApiConfig>,
): Promise<void> {
  await saveSetting(level, projectRoot, 'api', cfg)
}

export async function saveSetting(
  level: 'user' | 'project' | 'local',
  projectRoot: string,
  key: string,
  value: unknown,
): Promise<void> {
  const path = level === 'user'
    ? getUserConfigPath()
    : level === 'project'
      ? getProjectConfigPath(projectRoot)
      : getLocalConfigPath(projectRoot)

  let existing: Record<string, unknown> = {}
  try {
    const raw = await readFile(path, 'utf-8')
    existing = JSON.parse(raw)
  } catch { /* start fresh */ }

  existing[key] = value

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
}

export async function persistPermissionRules(
  level: 'user' | 'project' | 'local',
  projectRoot: string,
  rules: PermissionRule[],
): Promise<void> {
  const filteredRules = rules.filter(r => r.source === level || (level === 'local' && r.source === 'session'))
  await saveSetting(level, projectRoot, 'permissionRules', filteredRules)
}

export async function loadPermissionRules(projectRoot: string): Promise<PermissionRule[]> {
  const settings = await loadSettings(projectRoot)
  return settings.permissionRules || []
}

// ── 辅助 ──

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

/** 打印当前有效配置（用于 blino config show） */
export async function showConfig(projectRoot: string): Promise<void> {
  const cfg = await resolveApiConfig(projectRoot)
  const masked = cfg.apiKey
    ? cfg.apiKey.slice(0, 8) + '...' + cfg.apiKey.slice(-4)
    : '(not set)'

  console.log(`\nEffective configuration:`)
  console.log(`  provider:  ${cfg.provider}`)
  console.log(`  api key:   ${masked}`)
  console.log(`  base url:  ${cfg.baseUrl || '(default)'}`)
  console.log(`  model:     ${cfg.model}`)
  console.log(`\nConfig files (higher = higher priority):`)
  console.log(`  local:   ${getLocalConfigPath(projectRoot)}`)
  console.log(`  project: ${getProjectConfigPath(projectRoot)}`)
  console.log(`  global:  ${getUserConfigPath()}`)
}
