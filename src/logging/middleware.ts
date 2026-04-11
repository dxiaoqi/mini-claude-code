/**
 * Logging Middleware
 *
 * Middleware for logging API streams and tool executions.
 */
import { getLogger } from './logger.js'
import type { StreamEvent, Usage } from '../types.js'
import type { APILogEntry } from './types.js'

/**
 * Creates a logger for API streaming operations.
 */
export function createAPIStreamLogger(sessionId: string) {
  const logger = getLogger()
  let startTime = Date.now()
  let requestModel = ''

  return {
    onRequest(model: string) {
      requestModel = model
      startTime = Date.now()
      logger.logAPIRequest({
        sessionId,
        model,
      })
    },

    onResponse(usage: Usage, stopReason: string) {
      const duration = Date.now() - startTime
      logger.logAPIResponse({
        sessionId,
        model: requestModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        duration,
        stopReason,
      })
    },

    onError(error: Error) {
      const duration = Date.now() - startTime
      logger.logAPIError({
        sessionId,
        model: requestModel,
        error,
        duration,
      })
    },
  }
}

/**
 * Wraps a tool call with timing and logging.
 */
export async function withToolLogging<T>(
  toolName: string,
  input: Record<string, unknown>,
  operation: () => Promise<T>,
  sessionId: string
): Promise<{ result: T; duration: number }> {
  const logger = getLogger()
  const startTime = Date.now()

  logger.logToolStart({
    toolName,
    input,
  })

  try {
    const result = await operation()
    const duration = Date.now() - startTime

    logger.logToolEnd({
      toolName,
      input,
      output: result,
      duration,
    })

    return { result, duration }
  } catch (error) {
    const duration = Date.now() - startTime
    const err = error instanceof Error ? error : new Error(String(error))

    logger.logToolError({
      toolName,
      input,
      error: err,
      duration,
    })

    throw err
  }
}
