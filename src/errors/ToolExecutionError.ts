/**
 * ToolExecutionError - Tool Execution Errors
 *
 * Errors related to tool execution failures.
 */
import { BlinoError, ErrorCategory, ErrorContext, SuggestedAction } from './BlinoError.js'

export class ToolExecutionError extends BlinoError {
  constructor(
    message: string,
    context: ErrorContext = {},
    exitCode?: number,
    stderr?: string
  ) {
    const suggestedActions: SuggestedAction[] = [
      {
        title: 'Check Tool Arguments',
        description: 'Verify parameters passed to the tool are correct',
      },
    ]

    if (exitCode && exitCode !== 0) {
      suggestedActions.push({
        title: 'Exit Code',
        description: `Tool exited with code ${exitCode}. Check stderr for details.`,
      })
    }

    if (stderr) {
      suggestedActions.push({
        title: 'Error Output',
        description: `Tool reported: ${stderr}`,
      })
    }

    super(message, {
      category: ErrorCategory.TOOL_EXECUTION,
      context: { ...context, exitCode, stderr },
      suggestedActions,
      retryable: true,
      userFriendly: true,
    })

    this.name = 'ToolExecutionError'
  }
}
