import { describe, it, expect, vi } from 'vitest'
import { eventBus } from '../../src/events/EventBus.js'

describe('EventBus', () => {
  it('on receives emit', () => {
    const fn = vi.fn()
    const ev = 'unit_on_' + Math.random().toString(36).slice(2)
    eventBus.on(ev, fn)
    eventBus.emit(ev, { id: 'a', n: 1 })
    expect(fn).toHaveBeenCalledWith({ id: 'a', n: 1 })
  })

  it('waitFor resolves when id matches', async () => {
    const id = `sid-ok-${Date.now()}-${Math.random()}`
    const p = eventBus.waitFor('hil_resume', id)
    eventBus.emit('hil_resume', { id })
    await expect(p).resolves.toEqual({ id })
  })

  it('waitFor does not resolve on id mismatch; then does', async () => {
    const id = `sid-m-${Date.now()}-${Math.random()}`
    const p = eventBus.waitFor('hil_resume', id)
    eventBus.emit('hil_resume', { id: 'other' })
    const race = await Promise.race([
      p.then(() => 'resolved'),
      new Promise(r => setTimeout(() => r('timeout'), 20)),
    ])
    expect(race).toBe('timeout')
    eventBus.emit('hil_resume', { id })
    await expect(p).resolves.toEqual({ id })
  })

  it('waitFor times out and rejects', async () => {
    vi.useFakeTimers()
    const id = `sid-to-${Date.now()}`
    const p = eventBus.waitFor('hil_resume', id, 50)
    const settled = p.then(
      () => ({ type: 'ok' as const }),
      e => ({ type: 'err' as const, e }),
    )
    await vi.runAllTimersAsync()
    const r = await settled
    expect(r.type).toBe('err')
    if (r.type === 'err') {
      expect((r.e as Error).message).toMatch(/timed out/)
    }
    vi.useRealTimers()
  })
})
