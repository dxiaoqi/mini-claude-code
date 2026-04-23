import { describe, it, expect } from 'vitest'
import { resolveCorsAllowOrigin } from '../../../src/server/cors.js'

describe('resolveCorsAllowOrigin', () => {
  it('allows * when unconfigured and no request origin (curl)', () => {
    expect(resolveCorsAllowOrigin(undefined, '')).toBe('*')
  })

  it('reflects request origin when in comma-separated list', () => {
    const r = resolveCorsAllowOrigin(
      'http://localhost:3000,http://example.com',
      'http://example.com',
    )
    expect(r).toBe('http://example.com')
  })

  it('treats localhost and 127.0.0.1 as the same for same port and scheme', () => {
    const r = resolveCorsAllowOrigin('http://localhost:3000', 'http://127.0.0.1:3000')
    expect(r).toBe('http://127.0.0.1:3000')
  })

  it('rejects when port differs', () => {
    expect(
      resolveCorsAllowOrigin('http://localhost:3000', 'http://127.0.0.1:3001'),
    ).toBeNull()
  })
})
