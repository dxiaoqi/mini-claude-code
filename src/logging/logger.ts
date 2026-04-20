/**
 * Logger - Structured Logging Implementation
 *
 * Main Logger class based on Pino for production-grade structured logging.
 */
import pino from 'pino'
import pinoPretty from 'pino-pretty'
import type {
  LoggerConfig,
  LogContext,
  LogLevel,
  APILogEntry,
  ToolLogEntry,
  SecurityLogEntry,
} from './types.js'

export class Logger {
  private logger: pino.Logger
  private auditLogger: pino.Logger | null = null

  constructor(config: LoggerConfig = {}) {
    const level = config.level || this.determineLevel(config.development)

    const pinoConfig: pino.LoggerOptions = {
      level,
      name: config.name || 'lino',
      formatters: {
        level: (label) => {
          return { level: label }
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: {
        error: pino.stdSerializers.err,
      },
    }

    if (config.pretty) {
      // 交互模式下写到 stderr（fd=2），避免结构化日志污染 stdout 的 CLI 输出
      pinoConfig.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          destination: 2,
        },
      }
    }

    this.logger = pino(pinoConfig)

    // Separate audit logger for security events
    if (config.auditLogPath) {
      this.auditLogger = pino(
        {
          level: 'info',
          name: 'audit',
          formatters: {
            level: (label) => ({ level: label }),
          },
          timestamp: pino.stdTimeFunctions.isoTime,
        },
        pino.destination({ dest: config.auditLogPath, sync: false })
      )
    }
  }

  private determineLevel(development?: boolean): LogLevel {
    if (process.env.LOG_LEVEL) {
      return process.env.LOG_LEVEL as LogLevel
    }
    return development ? 'debug' : 'info'
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(context, message)
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(context, message)
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(context, message)
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.logger.error(
      {
        ...context,
        error: error?.message,
        stack: error?.stack,
      },
      message
    )
  }

  fatal(message: string, error?: Error, context?: LogContext): void {
    this.logger.fatal(
      {
        ...context,
        error: error?.message,
        stack: error?.stack,
      },
      message
    )
  }

  // API logging
  logAPIRequest(entry: Omit<APILogEntry, 'type'>): void {
    this.logger.info(
      {
        type: 'api_request',
        ...entry,
      },
      'API request'
    )
  }

  logAPIResponse(entry: Omit<APILogEntry, 'type'>): void {
    this.logger.info(
      {
        type: 'api_response',
        ...entry,
      },
      'API response'
    )
  }

  logAPIError(entry: Omit<APILogEntry, 'type'>): void {
    this.logger.error(
      {
        type: 'api_error',
        ...entry,
        error: entry.error?.message,
      },
      'API error'
    )
  }

  // Tool logging
  logToolStart(entry: Omit<ToolLogEntry, 'type'>): void {
    this.logger.info(
      {
        type: 'tool_start',
        ...entry,
        timestamp: Date.now(),
      },
      `Tool start: ${entry.toolName}`
    )
  }

  logToolEnd(entry: Omit<ToolLogEntry, 'type'>): void {
    this.logger.info(
      {
        type: 'tool_end',
        ...entry,
        timestamp: Date.now(),
      },
      `Tool end: ${entry.toolName}`
    )
  }

  logToolError(entry: Omit<ToolLogEntry, 'type'>): void {
    this.logger.error(
      {
        type: 'tool_error',
        ...entry,
        error: entry.error?.message,
        timestamp: Date.now(),
      },
      `Tool error: ${entry.toolName}`
    )
  }

  // Security logging
  logSecurityEvent(entry: SecurityLogEntry): void {
    const logData: Omit<SecurityLogEntry, 'type'> = {
      toolName: entry.toolName,
      decision: entry.decision,
      reason: entry.reason,
      riskLevel: entry.riskLevel,
      sessionId: entry.sessionId,
      command: entry.command,
      timestamp: Date.now(),
    }

    // Log to main logger
    this.logger.warn(logData, `Security event: ${entry.type}`)

    // Log to audit logger if configured
    if (this.auditLogger) {
      this.auditLogger.info({ ...logData, type: entry.type }, `Security event: ${entry.type}`)
    }
  }
}

// Global logger instance
let globalLogger: Logger | null = null

export function createLogger(config: LoggerConfig = {}): Logger {
  if (globalLogger) {
    return globalLogger
  }

  globalLogger = new Logger(config)
  return globalLogger
}

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger({})
  }
  return globalLogger
}

export function resetLogger(): void {
  globalLogger = null
}
