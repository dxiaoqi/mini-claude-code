/**
 * Error Types
 *
 * Type definitions for the error handling system.
 */
export enum ErrorCategory {
  NETWORK = 'network',
  VALIDATION = 'validation',
  TOOL_EXECUTION = 'tool_execution',
  CONFIGURATION = 'configuration',
  PERMISSION = 'permission',
  API = 'api',
  FILESYSTEM = 'filesystem',
  UNKNOWN = 'unknown',
}

export interface ErrorContext {
  sessionId?: string
  toolName?: string
  filePath?: string
  requestId?: string
  parameters?: Record<string, unknown>
  exitCode?: number
  stderr?: string
  [key: string]: unknown
}

export interface SuggestedAction {
  title: string
  description: string
  command?: string
}

export interface ErrorMetadata {
  category: ErrorCategory
  context: ErrorContext
  suggestedActions: SuggestedAction[]
  retryable: boolean
  userFriendly: boolean
}
