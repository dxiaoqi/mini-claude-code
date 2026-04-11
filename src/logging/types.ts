/**
 * Logging Types
 *
 * Type definitions for the structured logging system.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LoggerConfig {
  level?: LogLevel
  name?: string
  pretty?: boolean
  destination?: string
  auditLogPath?: string
  rotation?: {
    maxFiles?: number
    maxSize?: string
  }
  development?: boolean
}

export interface LogContext {
  sessionId?: string
  userId?: string
  requestId?: string
  toolName?: string
  duration?: number
  exitCode?: number
  [key: string]: unknown
}

export interface APILogEntry {
  sessionId?: string
  type: 'api_request' | 'api_response' | 'api_error'
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  duration?: number
  error?: Error
  stopReason?: string
}

export interface ToolLogEntry {
  type: 'tool_start' | 'tool_end' | 'tool_error'
  toolName: string
  input?: Record<string, unknown>
  output?: unknown
  duration?: number
  error?: Error
}

export interface SecurityLogEntry {
  type: 'permission_decision' | 'auth_failure' | 'security_event' | 'bash_command'
  toolName?: string
  decision?: 'allow' | 'deny' | 'ask'
  reason?: string
  riskLevel?: 'low' | 'medium' | 'high' | 'safe_read' | 'safe_write' | 'needs_confirmation' | 'dangerous'
  sessionId?: string
  command?: string
  timestamp?: number
}
