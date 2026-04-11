/**
 * ValidationError - Input Validation Errors
 *
 * Errors related to input validation and schema violations.
 */
import { MiniClaudeError, ErrorCategory, ErrorContext, SuggestedAction } from './MiniClaudeError.js'

export class ValidationError extends MiniClaudeError {
  constructor(
    message: string,
    context: ErrorContext = {},
    fieldName?: string,
    validValues?: unknown[]
  ) {
    const suggestedActions: SuggestedAction[] = [
      {
        title: 'Check Input',
        description: 'Verify input parameters are correct',
      },
    ]

    if (fieldName) {
      suggestedActions.push({
        title: `Check ${fieldName}`,
        description: `The ${fieldName} field has an invalid value`,
      })
    }

    if (validValues && validValues.length > 0) {
      suggestedActions.push({
        title: 'Valid Values',
        description: `Valid options are: ${validValues.join(', ')}`,
      })
    }

    super(message, {
      category: ErrorCategory.VALIDATION,
      context,
      suggestedActions,
      retryable: false,
      userFriendly: true,
    })

    this.name = 'ValidationError'
  }
}
