/**
 * WebSearchTool — 网络搜索工具
 *
 * 双模式实现（对齐 Claude Code 原版）：
 *
 * 1. Anthropic Provider（首选）：
 *    使用 Anthropic 原生 `web_search_20250305` server tool，发起独立子调用。
 *    AI 在子调用中自动决定搜索关键词并获取结果，无需额外 API Key。
 *    需要模型支持（claude-sonnet-4-x / claude-opus-4-x / claude-haiku-4-x）。
 *
 * 2. 第三方 API（Fallback）：
 *    当 provider 为 OpenAI Compatible 时，通过 Tavily API 执行搜索。
 *    需要配置 TAVILY_API_KEY 或在 settings.json 中设置 tavilyApiKey。
 *
 * 使用工厂函数创建，因为需要注入 apiClient 和 provider 信息。
 */

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { APIClient, PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  query: z.string().min(2).describe('The search query to use'),
  allowed_domains: z.array(z.string()).optional().describe('Only include results from these domains'),
  blocked_domains: z.array(z.string()).optional().describe('Never include results from these domains'),
})

type Input = z.infer<typeof inputSchema>

interface SearchResult {
  title: string
  url: string
  snippet?: string
}

interface Output {
  query: string
  results: (SearchResult | string)[]
  durationSeconds: number
  provider: 'anthropic' | 'tavily' | 'none'
}

export interface WebSearchConfig {
  provider: 'anthropic' | 'openai'
  anthropicApiKey?: string
  anthropicBaseUrl?: string
  tavilyApiKey?: string
}

/**
 * 创建 WebSearchTool。
 * 在 Anthropic provider 下使用原生 server tool；否则使用 Tavily。
 */
export function createWebSearchTool(
  apiClient: APIClient,
  searchConfig: WebSearchConfig,
): Tool<Input, Output> {
  const canUseAnthropicSearch = searchConfig.provider === 'anthropic'
  const canUseTavily = !!(searchConfig.tavilyApiKey || process.env.TAVILY_API_KEY)
  const isAvailable = canUseAnthropicSearch || canUseTavily

  return {
    name: 'WebSearch',
    aliases: ['WebSearchTool'],
    description: 'Search the web for current information. Returns search results with titles, URLs, and summaries.',

    inputSchema,
    shouldDefer: true,

    isReadOnly() { return true },
    isConcurrencySafe() { return true },

    isEnabled() {
      return isAvailable
    },

    async checkPermissions(input): Promise<PermissionResult> {
      if (!isAvailable) {
        return {
          behavior: 'deny',
          reason: canUseAnthropicSearch
            ? 'WebSearch requires Anthropic provider'
            : 'WebSearch requires TAVILY_API_KEY or tavilyApiKey in settings',
        }
      }
      return {
        behavior: 'passthrough',
        message: `Allow web search: ${input.query}`,
        suggestions: [{
          type: 'addRules',
          rules: [{ toolName: 'WebSearch' }],
          behavior: 'allow',
          destination: 'session',
        }],
      }
    },

    async call(input, context): Promise<ToolResult<Output>> {
      const start = performance.now()

      if (canUseAnthropicSearch) {
        return searchWithAnthropic(input, context.abortController.signal, searchConfig, start)
      } else if (canUseTavily) {
        return searchWithTavily(input, searchConfig.tavilyApiKey || process.env.TAVILY_API_KEY || '', start)
      }

      return {
        data: {
          query: input.query,
          results: ['WebSearch is not available. Configure TAVILY_API_KEY or use Anthropic provider.'],
          durationSeconds: 0,
          provider: 'none',
        },
      }
    },

    mapToolResultToToolResultBlockParam(output, toolUseID) {
      const header = `Web search results for: "${output.query}" (via ${output.provider}, ${output.durationSeconds.toFixed(1)}s)\n\n`

      const body = output.results.map(r => {
        if (typeof r === 'string') return r
        return `**${r.title}**\n${r.url}${r.snippet ? `\n${r.snippet}` : ''}`
      }).join('\n\n')

      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: header + body + '\n\nREMINDER: Include sources as markdown hyperlinks in your response.',
      }
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Anthropic native web_search_20250305 implementation
// ──────────────────────────────────────────────────────────────────────────

async function searchWithAnthropic(
  input: Input,
  signal: AbortSignal,
  config: WebSearchConfig,
  startTime: number,
): Promise<ToolResult<Output>> {
  const client = new Anthropic({
    apiKey: config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
    baseURL: config.anthropicBaseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  })

  // web_search_20250305 server tool schema
  const webSearchTool = {
    type: 'web_search_20250305' as const,
    name: 'web_search',
    max_uses: 8,
    ...(input.allowed_domains ? { allowed_domains: input.allowed_domains } : {}),
    ...(input.blocked_domains ? { blocked_domains: input.blocked_domains } : {}),
  }

  try {
    // 独立子调用：只传搜索 query，让模型调用 server tool
    const response = await client.beta.messages.create(
      {
        model: 'claude-haiku-4-20250514',  // 用轻量模型执行搜索
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `Perform a web search for: ${input.query}`,
        }],
        tools: [webSearchTool as unknown as Anthropic.Beta.BetaTool],
        betas: ['web-search-2025-03-05'],
      },
      { signal }
    )

    const results: (SearchResult | string)[] = []
    let textAcc = ''

    for (const block of response.content) {
      const b = block as unknown as Record<string, unknown>

      if (b.type === 'text') {
        textAcc += b.text as string
      } else if (b.type === 'web_search_tool_result') {
        const content = b.content
        if (Array.isArray(content)) {
          for (const item of content as Array<Record<string, unknown>>) {
            if (item.type === 'web_search_result') {
              results.push({
                title: (item.title as string) || '',
                url: (item.url as string) || '',
                snippet: item.encrypted_content
                  ? '[Content encrypted by server]'
                  : (item.page_age as string | undefined),
              })
            }
          }
        } else if (typeof content === 'object' && content && 'error_code' in content) {
          results.push(`Search error: ${(content as Record<string, unknown>).error_code}`)
        }
      }
    }

    // 把 AI 生成的摘要文本也加进来
    if (textAcc.trim()) {
      results.push(textAcc.trim())
    }

    const durationSeconds = (performance.now() - startTime) / 1000

    return {
      data: {
        query: input.query,
        results: results.length > 0 ? results : ['No results found.'],
        durationSeconds,
        provider: 'anthropic',
      },
    }
  } catch (err) {
    const msg = (err as Error).message
    // 模型不支持 web search 时给出友好提示
    if (msg.includes('web_search') || msg.includes('beta')) {
      return {
        data: {
          query: input.query,
          results: [`Web search not supported by current model/endpoint. Error: ${msg}`],
          durationSeconds: 0,
          provider: 'anthropic',
        },
      }
    }
    throw err
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Tavily fallback implementation
// ──────────────────────────────────────────────────────────────────────────

async function searchWithTavily(
  input: Input,
  apiKey: string,
  startTime: number,
): Promise<ToolResult<Output>> {
  const body: Record<string, unknown> = {
    api_key: apiKey,
    query: input.query,
    search_depth: 'basic',
    max_results: 8,
    include_answer: true,
  }
  if (input.allowed_domains) body.include_domains = input.allowed_domains
  if (input.blocked_domains) body.exclude_domains = input.blocked_domains

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Tavily API error ${res.status}: ${err}`)
  }

  const data = await res.json() as {
    answer?: string
    results?: Array<{ title: string; url: string; content?: string }>
  }

  const results: (SearchResult | string)[] = []

  if (data.answer) results.push(data.answer)

  for (const r of data.results || []) {
    results.push({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 200),
    })
  }

  return {
    data: {
      query: input.query,
      results: results.length > 0 ? results : ['No results found.'],
      durationSeconds: (performance.now() - startTime) / 1000,
      provider: 'tavily',
    },
  }
}
