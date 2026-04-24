/**
 * Logging Module
 *
 * Centralized logging system for Blino.
 *
 * Exports:
 * - Logger class for direct instantiation
 * - createLogger() factory function
 * - getLogger() singleton accessor
 * - Middleware for API and tool logging
 *
 * Usage:
 * ```ts
 * import { getLogger } from './logging/index.js'
 *
 * const logger = getLogger()
 * logger.info('Application started')
 *
 * // For specific contexts
 * logger.info('Tool executed', { toolName: 'Read', duration: 123 })
 *
 * // Security events (goes to audit log)
 * logger.logSecurityEvent({
 *   type: 'permission_decision',
 *   toolName: 'Bash',
 *   decision: 'deny',
 *   reason: 'Dangerous command',
 *   sessionId: 'abc123'
 * })
 * ```
 */

export { Logger, createLogger, getLogger, resetLogger } from './logger.js'
export { createAPIStreamLogger, withToolLogging } from './middleware.js'
export * from './types.js'
