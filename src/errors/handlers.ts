/**
 * Error Handlers
 *
 * Centralized error handling functions for the application.
 */
import { getLogger } from '../logging/index.js'
import { LinoError } from './LinoError.js'
import type { ErrorContext } from './types.js'
import { ValidationError } from './ValidationError.js'
import { ConfigurationError } from './ConfigurationError.js'
import { NetworkError } from './NetworkError.js'

/**
 * Handle a critical error that should stop the application.
 */
export function handleError(error: unknown, context: ErrorContext = {}): never {
  const logger = getLogger()

  // Convert to LinoError if needed
  const normalizedError: LinoError = error instanceof LinoError
    ? error
    : error instanceof Error
      ? (() => {
        const message = error.message.toLowerCase()

        if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
          return new NetworkError(error.message, context)
        }

        if (message.includes('econnrefused') || message.includes('enotfound')) {
          return new NetworkError(error.message, context)
        }

        if (message.includes('validation') || message.includes('invalid')) {
          return new ValidationError(error.message, context)
        }

        if (message.includes('config')) {
          return new ConfigurationError(error.message, context)
        }

        // Default to generic LinoError
        return new LinoError(error.message, {
          context,
          userFriendly: false,
        })
      })()
      : new LinoError(String(error), {
          context,
          userFriendly: false,
        })

  // Log error
  if (normalizedError.category === 'network') {
    logger.error(normalizedError.message, normalizedError as Error, context)
  } else {
    logger.warn(normalizedError.message, { ...context, error: normalizedError.toJSON() })
  }

  // Display user-friendly message
  if (normalizedError.userFriendly) {
    console.error(`\n❌ Error: ${normalizedError.getUserMessage()}`)
  } else {
    console.error(`\n❌ Error: ${normalizedError.message}`)
  }

  // Exit with appropriate code
  process.exit(1)
}

/**
 * Handle a non-critical error that should be logged but not stop execution.
 */
export function handleSilentError(error: unknown, context: ErrorContext = {}): void {
  const logger = getLogger()
  const normalizedError: LinoError = error instanceof LinoError
    ? error
    : error instanceof Error
      ? (() => {
        const message = error.message.toLowerCase()

        if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
          return new NetworkError(error.message, context)
        }

        if (message.includes('econnrefused') || message.includes('enotfound')) {
          return new NetworkError(error.message, context)
        }

        if (message.includes('validation') || message.includes('invalid')) {
          return new ValidationError(error.message, context)
        }

        if (message.includes('config')) {
          return new ConfigurationError(error.message, context)
        }

        // Default to generic LinoError
        return new LinoError(error.message, {
          context,
          userFriendly: false,
        })
      })()
      : new LinoError(String(error), {
          context,
          userFriendly: false,
        })

  logger.error(
    `Silent error occurred: ${normalizedError.message}`,
    normalizedError as Error,
    context
  )
}
