/**
 * SessionState Tests
 *
 * Tests for session state management.
 */
import { describe, it, expect } from 'vitest'
import { createSessionState, addMessage, clearSession, accumulateUsage } from '../../../src/state/SessionState.js'
import type { Message } from '../../../src/types.js'

describe('createSessionState', () => {
  it('should create a valid session state', () => {
    const state = createSessionState({
      cwd: '/test/cwd',
      projectRoot: '/test/project',
    })

    expect(state.sessionId).toBeDefined()
    expect(state.sessionId).toMatch(/^[a-f0-9-]{36}$/) // UUID format
    expect(state.cwd).toBe('/test/cwd')
    expect(state.projectRoot).toBe('/test/project')
    expect(state.messages).toEqual([])
    expect(state.totalInputTokens).toBe(0)
    expect(state.totalOutputTokens).toBe(0)
    expect(state.totalCostUSD).toBe(0)
  })

  it('should use provided settings', () => {
    const settings = {
      model: 'custom-model',
      permissionMode: 'bypass' as const,
      permissionRules: [{ tool: 'Bash', decision: 'allow', source: 'session' }],
    }

    const state = createSessionState({
      cwd: '/test/cwd',
      settings,
    })

    expect(state.model).toBe('custom-model')
    expect(state.permissionMode).toBe('bypass')
    expect(state.permissionRules).toEqual(settings.permissionRules)
  })

  it('should use default model when not provided', () => {
    const state = createSessionState({
      cwd: '/test/cwd',
    })

    expect(state.model).toBe('gpt-4o')
  })

  it('should initialize empty collections', () => {
    const state = createSessionState({
      cwd: '/test/cwd',
    })

    expect(state.modelUsage).toBeInstanceOf(Map)
    expect(state.modelUsage.size).toBe(0)
    expect(state.denialCounts).toBeInstanceOf(Map)
    expect(state.denialCounts.size).toBe(0)
    expect(state.activeAgents).toBeInstanceOf(Map)
    expect(state.activeAgents.size).toBe(0)
  })
})

describe('addMessage', () => {
  it('should add a message to state', () => {
    const state = createSessionState({ cwd: '/test/cwd' })
    const message: Message = {
      role: 'user',
      content: 'Hello',
    }

    addMessage(state, message)

    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toEqual(message)
  })

  it('should append multiple messages', () => {
    const state = createSessionState({ cwd: '/test/cwd' })
    const message1: Message = { role: 'user', content: 'Hello' }
    const message2: Message = { role: 'assistant', content: 'Hi there' }

    addMessage(state, message1)
    addMessage(state, message2)

    expect(state.messages).toHaveLength(2)
    expect(state.messages[0]).toEqual(message1)
    expect(state.messages[1]).toEqual(message2)
  })

  it('should not modify existing messages array', () => {
    const state = createSessionState({ cwd: '/test/cwd' })
    const initialMessages = [...state.messages]
    const message: Message = { role: 'user', content: 'Test' }

    addMessage(state, message)

    expect(initialMessages).toHaveLength(0)
    expect(state.messages).toHaveLength(1)
  })
})

describe('accumulateUsage', () => {
  it('should accumulate token counts', () => {
    const state = createSessionState({ cwd: '/test/cwd' })

    accumulateUsage(state, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
    }, 'model-1')

    expect(state.totalInputTokens).toBe(100)
    expect(state.totalOutputTokens).toBe(50)
  })

  it('should accumulate multiple usages', () => {
    const state = createSessionState({ cwd: '/test/cwd' })

    accumulateUsage(state, {
      inputTokens: 100,
      outputTokens: 50,
    }, 'model-1')

    accumulateUsage(state, {
      inputTokens: 200,
      outputTokens: 100,
    }, 'model-1')

    expect(state.totalInputTokens).toBe(300)
    expect(state.totalOutputTokens).toBe(150)
  })

  it('should track usage per model', () => {
    const state = createSessionState({ cwd: '/test/cwd' })

    accumulateUsage(state, {
      inputTokens: 100,
      outputTokens: 50,
    }, 'model-1')

    accumulateUsage(state, {
      inputTokens: 200,
      outputTokens: 100,
    }, 'model-2')

    expect(state.modelUsage.get('model-1')).toEqual({
      input: 100,
      output: 50,
      cacheRead: 0,
    })

    expect(state.modelUsage.get('model-2')).toEqual({
      input: 200,
      output: 100,
      cacheRead: 0,
    })
  })

  it('should accumulate model-specific usage', () => {
    const state = createSessionState({ cwd: '/test/cwd' })

    accumulateUsage(state, {
      inputTokens: 100,
      outputTokens: 50,
    }, 'model-1')

    accumulateUsage(state, {
      inputTokens: 50,
      outputTokens: 25,
    }, 'model-1')

    expect(state.modelUsage.get('model-1')).toEqual({
      input: 150,
      output: 75,
      cacheRead: 0,
    })
  })
})

describe('clearSession', () => {
  it('should reset session state', () => {
    const state = createSessionState({ cwd: '/test/cwd' })

    // Add some data
    const message: Message = { role: 'user', content: 'Test' }
    addMessage(state, message)

    accumulateUsage(state, {
      inputTokens: 100,
      outputTokens: 50,
    }, 'model-1')

    const initialSessionId = state.sessionId

    clearSession(state)

    expect(state.sessionId).not.toBe(initialSessionId)
    expect(state.messages).toEqual([])
    expect(state.totalInputTokens).toBe(0)
    expect(state.totalOutputTokens).toBe(0)
    expect(state.totalCostUSD).toBe(0)
  })

  it('should clear model usage map', () => {
    const state = createSessionState({ cwd: '/test/cwd' })

    accumulateUsage(state, {
      inputTokens: 100,
      outputTokens: 50,
    }, 'model-1')

    clearSession(state)

    expect(state.modelUsage.size).toBe(0)
  })

  it('should clear denial counts', () => {
    const state = createSessionState({ cwd: '/test/cwd' })

    state.denialCounts.set('Bash', 3)

    clearSession(state)

    expect(state.denialCounts.size).toBe(0)
  })

  it('should clear active agents', () => {
    const state = createSessionState({ cwd: '/test/cwd' })

    state.activeAgents.set('agent-1', { handle: 'mock' } as any)

    clearSession(state)

    expect(state.activeAgents.size).toBe(0)
  })

  it('should clear system prompt section cache', () => {
    const state = createSessionState({ cwd: '/test/cwd' })

    state.systemPromptSectionCache.set('key', 'value')

    clearSession(state)

    expect(state.systemPromptSectionCache.size).toBe(0)
  })

  it('should reset prompt cache latches', () => {
    const state = createSessionState({ cwd: '/test/cwd' })

    state.promptCacheLatches.autoModeHeaderLatched = true
    state.promptCacheLatches.thinkingClearLatched = false

    clearSession(state)

    expect(state.promptCacheLatches.autoModeHeaderLatched).toBeNull()
    expect(state.promptCacheLatches.fastModeHeaderLatched).toBeNull()
    expect(state.promptCacheLatches.thinkingClearLatched).toBeNull()
  })
})
