/**
 * Rebuild APIClient from workspace config (files + env), matching CLI startup logic.
 */
import { createOpenAICompatibleClient } from '../api/client.js'
import { createAnthropicClient } from '../api/anthropicClient.js'
import { withRetry, withFallback } from '../api/retry.js'
import { resolveApiConfig } from '../utils/config.js'
import type { APIClient } from '../types.js'

export async function rebuildApiClientFromWorkspace(cwd: string): Promise<APIClient> {
  const resolved = await resolveApiConfig(cwd)
  let base: APIClient
  if (resolved.provider === 'anthropic') {
    base = createAnthropicClient({
      apiKey: resolved.apiKey,
      baseURL: resolved.baseUrl || 'https://api.anthropic.com',
      defaultModel: resolved.model,
    })
  } else {
    if (!resolved.baseUrl) {
      throw new Error(
        'OpenAI-compatible provider requires a base URL (set openaiBaseUrl in .blino/settings.local.json or OPENAI_BASE_URL)',
      )
    }
    base = createOpenAICompatibleClient({
      apiKey: resolved.apiKey,
      baseURL: resolved.baseUrl,
      defaultModel: resolved.model,
    })
  }
  const retried = withRetry(base, { maxRetries: 2 })
  return resolved.fallbackModel ? withFallback(retried, resolved.fallbackModel) : retried
}
