/**
 * Test Setup
 *
 * Global test configuration and mocks.
 */
import { vi } from 'vitest'

// Set test environment
process.env.NODE_ENV = 'test'

// Mock file system for tests (optional - can be overridden in specific tests)
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}))

// Mock logger to avoid actual logging in tests
vi.mock('../src/logging/index.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    logToolStart: vi.fn(),
    logToolEnd: vi.fn(),
    logToolError: vi.fn(),
    logAPIRequest: vi.fn(),
    logAPIResponse: vi.fn(),
    logAPIError: vi.fn(),
    logSecurityEvent: vi.fn(),
  })),
  getLogger: vi.fn(),
}))
