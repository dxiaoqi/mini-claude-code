/**
 * MiniClaudeError - Base Error Class
 *
 * Base class for all custom errors in Blino.
 */
import { ErrorCategory } from './types.js'
import type { ErrorContext, SuggestedAction, ErrorMetadata } from './types.js'
export { ErrorCategory } from './types.js'
export type { ErrorContext, SuggestedAction, ErrorMetadata } from './types.js'

export class MiniClaudeError extends Error {
  public readonly category: ErrorCategory
  public readonly context: ErrorContext
  public readonly suggestedActions: SuggestedAction[]
  public readonly retryable: boolean
  public readonly userFriendly: boolean

  constructor(
    message: string,
    metadata: Partial<ErrorMetadata> = {}
  ) {
    super(message)
    this.name = this.constructor.name

    this.category = metadata.category || ErrorCategory.UNKNOWN
    this.context = metadata.context || {}
    this.suggestedActions = metadata.suggestedActions || []
    this.retryable = metadata.retryable ?? true
    this.userFriendly = metadata.userFriendly ?? true

    Error.captureStackTrace(this, this.constructor)
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      context: this.context,
      suggestedActions: this.suggestedActions,
      retryable: this.retryable,
      stack: this.stack,
    }
  }

  getUserMessage(): string {
    let message = this.message

    if (this.suggestedActions.length > 0) {
      message += '\n\nSuggested actions:\n'
      message += this.suggestedActions
        .map((action, i) => `${i + 1}. ${action.title}: ${action.description}`)
        .join('\n')
    }

    return message
  }
}
