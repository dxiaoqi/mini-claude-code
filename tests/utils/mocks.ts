/**
 * Test Utilities
 *
 * Common mock helpers and test fixtures.
 */
import type { ToolContext, SessionState } from '../../src/types.js'

export function createMockToolContext(): ToolContext {
  return {
    sessionState: createMockSessionState(),
    cwd: '/test/cwd',
    abortController: new AbortController(),
    options: {
      tools: [],
      mainModel: 'test-model',
    },
  }
}

export function createMockSessionState(): SessionState {
  return {
    sessionId: 'test-session-id',
    cwd: '/test/cwd',
    projectRoot: '/test/cwd',
    messages: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUSD: 0,
    modelUsage: new Map(),
    permissionMode: 'default',
    permissionRules: [],
    denialCounts: new Map(),
    activeAgents: new Map(),
    promptCacheLatches: {
      autoModeHeaderLatched: null,
      fastModeHeaderLatched: null,
      thinkingClearLatched: null,
    },
    systemPromptSectionCache: new Map(),
    model: 'test-model',
    settings: {},
  }
}

export function mockChildProcess(proc: {
  stdout?: string
  stderr?: string
  exitCode?: number
  signal?: string
}) {
  const callbacks: Record<string, Function[]> = {}
  const mock = {
    stdout: {
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'data' && proc.stdout) {
          // Simulate data emission after a tick
          setImmediate(() => {
            handler(Buffer.from(proc.stdout!))
          })
        }
        callbacks[`stdout:${event}`] = callbacks[`stdout:${event}`] || []
        callbacks[`stdout:${event}`].push(handler)
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'data' && proc.stderr) {
          setImmediate(() => {
            handler(Buffer.from(proc.stderr!))
          })
        }
        callbacks[`stderr:${event}`] = callbacks[`stderr:${event}`] || []
        callbacks[`stderr:${event}`].push(handler)
      }),
    },
    on: vi.fn((event: string, handler: Function) => {
      callbacks[event] = callbacks[event] || []
      callbacks[event].push(handler)

      if (event === 'close') {
        setTimeout(() => {
          handler(proc.exitCode ?? 0)
        }, 10)
      } else if (event === 'error' && proc.signal) {
        setTimeout(() => {
          handler(new Error(proc.signal!))
        }, 5)
      }
    }),
    kill: vi.fn((signal?: string) => {
      // Trigger close event with signal
      const handlers = callbacks['close'] || []
      handlers.forEach((h: Function) => h(null))
    }),
  }

  return mock
}
