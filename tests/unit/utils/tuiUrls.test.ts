import { describe, it, expect } from 'vitest'
import {
  buildTuiCorsOrigins,
  buildTuiPublicApiBaseUrl,
  buildTuiBrowserUrl,
  isBindAll,
} from '../../../src/utils/tuiUrls.js'

describe('tuiUrls', () => {
  it('isBindAll', () => {
    expect(isBindAll('0.0.0.0')).toBe(true)
    expect(isBindAll('127.0.0.1')).toBe(false)
  })

  it('buildTuiBrowserUrl maps 0.0.0.0 to loopback', () => {
    expect(buildTuiBrowserUrl('0.0.0.0', 3000)).toBe('http://127.0.0.1:3000')
  })

  it('buildTuiCorsOrigins includes localhost pair for any host', () => {
    const s = buildTuiCorsOrigins('192.168.1.5', 3000, {})
    expect(s).toContain('http://localhost:3000')
    expect(s).toContain('http://127.0.0.1:3000')
    expect(s).toContain('http://192.168.1.5:3000')
  })

  it('buildTuiPublicApiUrl uses env when set', () => {
    const u = buildTuiPublicApiBaseUrl('0.0.0.0', 3001, {
      BLINO_PUBLIC_API_URL: 'https://api.example.com',
    })
    expect(u).toBe('https://api.example.com')
  })
})
