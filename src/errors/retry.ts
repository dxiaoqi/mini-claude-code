/**
 * Retry Logic
 *
 * Retry mechanisms with exponential backoff for transient failures.
 */
import { getLogger } from '../logging/index.js'
import { MiniClaudeError } from './MiniClaudeError.js'
import { ErrorCategory } from './MiniClaudeError.js'

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  backoffFactor?: number
  jitter?: boolean
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  jitter: true,
}

/**
 * Execute an operation with retry logic.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
  errorFilter?: (error: Error) => boolean
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options }
  const logger = getLogger()

  let lastError: Error | null = null
  let attempt = 0

  while (attempt <= opts.maxRetries) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Check if error is retryable
      const shouldRetry = errorFilter
        ? errorFilter(lastError)
        : isRetryableError(lastError)

      if (!shouldRetry || attempt === opts.maxRetries) {
        throw lastError
      }

      // Calculate delay with exponential backoff
      const delay = calculateDelay(attempt, opts)

      logger.warn(
        `Operation failed, retrying in ${delay}ms (attempt ${attempt + 1}/${opts.maxRetries + 1})`,
        {
          error: lastError.message,
          attempt: attempt + 1,
          maxRetries: opts.maxRetries + 1,
        }
      )

      await sleep(delay)
      attempt++
    }
  }

  throw lastError
}

/**
 * Check if an error is retryable.
 */
function isRetryableError(error: Error): boolean {
  // Network errors are retryable
  if (error instanceof MiniClaudeError) {
    return error.retryable && error.category !== ErrorCategory.VALIDATION
  }

  // Network-related errors
  const message = error.message.toLowerCase()
  const retryablePatterns = [
    'timeout',
    'network',
    'connection',
    'econnreset',
    'etimedout',
    'enotfound',
    'econnrefused',
  ]

  return retryablePatterns.some(pattern => message.includes(pattern))
}

/**
 * Calculate retry delay with exponential backoff.
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
  const exponentialDelay = options.baseDelayMs * Math.pow(options.backoffFactor, attempt)
  const delay = Math.min(exponentialDelay, options.maxDelayMs)

  // Add jitter to prevent thundering herd
  if (options.jitter) {
    return delay + Math.random() * 500
  }

  return delay
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
