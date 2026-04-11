/**
 * api/retry.ts — API 重试与模型降级
 *
 * 对可重试错误采用指数退避；失败时可通过 FallbackTriggeredError 切换到备用模型。
 */
import type { APIClient, CallModelParams, StreamEvent } from '../types.js'

export interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  retryableStatusCodes: number[]
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  retryableStatusCodes: [429, 500, 502, 503, 529],
}

export class FallbackTriggeredError extends Error {
  constructor(public originalError: Error, public fallbackModel: string) {
    super(`Switching to fallback model: ${fallbackModel}`)
    this.name = 'FallbackTriggeredError'
  }
}

export function withRetry(
  client: APIClient,
  config: Partial<RetryConfig> = {},
  fallbackModel?: string,
): APIClient {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config }

  return {
    async *callModel(params: CallModelParams): AsyncGenerator<StreamEvent> {
      let lastError: Error | null = null

      for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
          const stream = client.callModel(params)

          for await (const event of stream) {
            yield event
          }

          return
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))

          const statusCode = extractStatusCode(lastError)
          const isRetryable = statusCode !== null && cfg.retryableStatusCodes.includes(statusCode)

          if (!isRetryable || attempt === cfg.maxRetries) {
            // On final failure, try fallback model if configured
            if (fallbackModel && fallbackModel !== params.model) {
              throw new FallbackTriggeredError(lastError, fallbackModel)
            }
            throw lastError
          }

          const delay = Math.min(
            cfg.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
            cfg.maxDelayMs,
          )

          await sleep(delay)
        }
      }

      throw lastError || new Error('Retry exhausted')
    },
  }
}

/**
 * Wraps a client to handle FallbackTriggeredError by retrying with the fallback model.
 */
export function withFallback(
  primaryClient: APIClient,
  fallbackModel: string,
  retryConfig?: Partial<RetryConfig>,
): APIClient {
  const retriedClient = withRetry(primaryClient, retryConfig, fallbackModel)

  return {
    async *callModel(params: CallModelParams): AsyncGenerator<StreamEvent> {
      try {
        yield* retriedClient.callModel(params)
      } catch (err) {
        if (err instanceof FallbackTriggeredError) {
          yield {
            type: 'text_delta',
            text: `\n[Switched to fallback model: ${err.fallbackModel}]\n`,
          }

          const fallbackParams = { ...params, model: err.fallbackModel }
          yield* primaryClient.callModel(fallbackParams)
        } else {
          throw err
        }
      }
    },
  }
}

function extractStatusCode(err: Error): number | null {
  const anyErr = err as unknown as Record<string, unknown>

  if (typeof anyErr.status === 'number') return anyErr.status
  if (typeof anyErr.statusCode === 'number') return anyErr.statusCode

  if (anyErr.error && typeof anyErr.error === 'object') {
    const inner = anyErr.error as Record<string, unknown>
    if (typeof inner.status === 'number') return inner.status
  }

  const match = err.message.match(/(\d{3})/)
  if (match) {
    const code = parseInt(match[1], 10)
    if (code >= 400 && code < 600) return code
  }

  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
