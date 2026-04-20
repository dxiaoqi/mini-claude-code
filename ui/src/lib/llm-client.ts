/**
 * LLM Client — Visual mode (Orchestrator) LLM calls
 * Reads provider/model/key config from Blino's /api/config at runtime.
 * Falls back to ARTIFACTS_LLM_* env vars for standalone development.
 */

import OpenAI from 'openai'

const BLINO_URL = process.env.BLINO_API_URL || process.env.NEXT_PUBLIC_BLINO_URL || 'http://localhost:3001'

interface LLMConfig {
  apiKey: string
  baseURL?: string
  model: string
}

let _cachedConfig: LLMConfig | null = null
let _cacheExpiry = 0

async function getLLMConfig(): Promise<LLMConfig> {
  // Cache config for 30 seconds to avoid per-request fetches
  if (_cachedConfig && Date.now() < _cacheExpiry) return _cachedConfig

  try {
    const res = await fetch(`${BLINO_URL}/api/config`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const data = await res.json()
      const api = data.api || {}
      const provider = api.provider || 'anthropic'
      const model = api.model || data.model || process.env.ARTIFACTS_LLM_MODEL || 'claude-3-5-sonnet-20241022'

      if (provider === 'anthropic') {
        const config: LLMConfig = {
          apiKey: process.env.ARTIFACTS_LLM_API_KEY || 'missing-key',
          baseURL: api.anthropicBaseUrl || process.env.ARTIFACTS_LLM_BASE_URL,
          model,
        }
        _cachedConfig = config
        _cacheExpiry = Date.now() + 30_000
        return config
      } else {
        const config: LLMConfig = {
          apiKey: process.env.ARTIFACTS_LLM_API_KEY || 'missing-key',
          baseURL: api.openaiBaseUrl || process.env.ARTIFACTS_LLM_BASE_URL,
          model,
        }
        _cachedConfig = config
        _cacheExpiry = Date.now() + 30_000
        return config
      }
    }
  } catch {
    // Fall through to env var fallback
  }

  return {
    apiKey: process.env.ARTIFACTS_LLM_API_KEY ?? 'missing-key',
    baseURL: process.env.ARTIFACTS_LLM_BASE_URL,
    model: process.env.ARTIFACTS_LLM_MODEL || 'claude-3-5-sonnet-20241022',
  }
}

export const MODEL = process.env.ARTIFACTS_LLM_MODEL || 'claude-3-5-sonnet-20241022'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamCallOptions {
  messages: Message[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  onChunk?: (text: string) => void
}

export interface StreamCallResult {
  text: string
  finishReason: 'stop' | 'length' | null
}

export async function streamCall(opts: StreamCallOptions): Promise<StreamCallResult> {
  const { messages, maxTokens = 8000, temperature = 0.7, signal, onChunk } = opts

  const config = await getLLMConfig()
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })

  const stream = await client.chat.completions.create({
    model: config.model,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: true,
    stream_options: { include_usage: false },
  })

  let full = ''
  let finishReason: 'stop' | 'length' | null = null
  for await (const chunk of stream) {
    if (signal?.aborted) break
    const text = chunk.choices[0]?.delta?.content ?? ''
    if (text) { full += text; onChunk?.(text) }
    const fr = chunk.choices[0]?.finish_reason
    if (fr) finishReason = fr as 'stop' | 'length'
  }
  return { text: full, finishReason }
}

export async function callOnce(messages: Message[], maxTokens = 200): Promise<string> {
  const config = await getLLMConfig()
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
  const res = await client.chat.completions.create({
    model: config.model,
    messages,
    max_tokens: maxTokens,
    temperature: 0,
    stream: false,
  })
  return res.choices[0]?.message?.content ?? ''
}

export async function callStructured<T>(
  messages: Message[],
  schema: import('zod').ZodType<T>,
  opts: { system?: string; maxTokens?: number; fallback?: T } = {},
): Promise<T> {
  const { system, maxTokens = 200, fallback } = opts
  const allMessages: Message[] = system
    ? [{ role: 'system', content: system + '\nRespond with a valid JSON object only.' }, ...messages]
    : messages

  let raw = ''
  try { raw = await callOnce(allMessages, maxTokens) } catch {
    if (fallback !== undefined) return fallback
    throw new Error('callStructured failed')
  }

  let parsed: unknown
  try { parsed = JSON.parse(raw.trim()) } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    try { parsed = m ? JSON.parse(m[0]) : {} } catch { parsed = {} }
  }

  const result = schema.safeParse(parsed)
  if (result.success) return result.data
  if (fallback !== undefined) return fallback
  throw new Error(`Schema validation failed: ${result.error.message}`)
}
