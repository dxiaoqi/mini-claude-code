/**
 * ToolExecutionError - Tool Execution Errors
 *
 * Errors related to tool execution failures.
 */
import { LinoError, ErrorCategory, ErrorContext, SuggestedAction } from './LinoError.js'

export class ToolExecutionError extends LinoError {
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
