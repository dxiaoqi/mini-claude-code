/**
 * NetworkError - Network Operation Errors
 *
 * Errors related to network operations and API calls.
 */
import { BlinoError, ErrorCategory, ErrorContext, SuggestedAction } from './BlinoError.js'
import type { ErrorMetadata } from './types.js'
import { BLINO_TILDE_ROOT } from '../constants/blinoPaths.js'

export class NetworkError extends BlinoError {
  constructor(
    message: string,
    context: ErrorContext = {},
    statusCode?: number
  ) {
    const suggestedActions: SuggestedAction[] = []

    if (statusCode === 401) {
      suggestedActions.push({
        title: 'Check API Key',
        description: `Verify your API key is correct in ${BLINO_TILDE_ROOT}/settings.json`,
      })
    } else if (statusCode === 429) {
      suggestedActions.push({
        title: 'Rate Limited',
        description: 'Wait a few minutes before trying again, or upgrade your API tier',
      })
    } else if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
      suggestedActions.push({
        title: 'Server Error',
        description: 'The API service is experiencing issues. Try again later.',
      })
    } else {
      suggestedActions.push({
        title: 'Check Network',
        description: 'Verify your internet connection is working',
      })
    }

    const metadata: ErrorMetadata = {
      category: ErrorCategory.NETWORK,
      context: { ...context, statusCode },
      suggestedActions,
      retryable: statusCode !== 401,
      userFriendly: true,
    }

    super(message, metadata)

    this.name = 'NetworkError'
  }
}
