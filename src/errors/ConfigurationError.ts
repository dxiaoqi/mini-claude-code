/**
 * ConfigurationError - Configuration Errors
 *
 * Errors related to configuration issues.
 */
import { MiniClaudeError, ErrorCategory, ErrorContext, SuggestedAction } from './MiniClaudeError.js'

export class ConfigurationError extends MiniClaudeError {
  constructor(
    message: string,
    context: ErrorContext = {},
    configKey?: string,
    configPath?: string
  ) {
    const suggestedActions: SuggestedAction[] = []

    if (configKey) {
      suggestedActions.push({
        title: `Check ${configKey}`,
        description: `The configuration key "${configKey}" is missing or invalid`,
      })
    }

    if (configPath) {
      suggestedActions.push({
        title: 'Check Config File',
        description: `Verify ${configPath} exists and is valid JSON`,
      })
    }

    suggestedActions.push({
      title: 'Run /config',
      description: 'Use /config command to view current configuration',
    })

    super(message, {
      category: ErrorCategory.CONFIGURATION,
      context: { ...context, configKey, configPath },
      suggestedActions,
      retryable: false,
      userFriendly: true,
    })

    this.name = 'ConfigurationError'
  }
}
