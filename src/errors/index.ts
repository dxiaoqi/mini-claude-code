/**
 * Error Handling Module
 *
 * Centralized error handling and retry logic.
 *
 * Usage:
 * ```ts
 * import { handleError, handleSilentError, withRetry } from './errors/index.js'
 *
 * // Handle critical errors
 * try {
 *   await someOperation()
 * } catch (err) {
 *   handleError(err, { sessionId: 'abc123' })
 * }
 *
 * // Handle non-critical errors
 * someOperation().catch(err => {
 *   handleSilentError(err, { context: 'transcript' })
 * })
 *
 * // Retry operations
 * const result = await withRetry(() => apiCall(), {
 *   maxRetries: 3,
 *   baseDelayMs: 1000,
 * })
 * ```
 */

export * from './LinoError.js'
export * from './NetworkError.js'
export * from './ValidationError.js'
export * from './ToolExecutionError.js'
export * from './ConfigurationError.js'
export * from './types.js'
export * from './retry.js'
export * from './handlers.js'
