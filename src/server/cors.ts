/**
 * CORS: echo `Access-Control-Allow-Origin` to match the browser's `Origin` when allowed.
 * Treats `http://localhost:<p>` and `http://127.0.0.1:<p>` (same scheme+port) as the same
 * dev host, so `--cors-origin http://localhost:3000` still works if the user opens
 * `http://127.0.0.1:3000` in the tab (a common "Failed to fetch" cause).
 */

function parseAllowedOrigins(allowed: string | undefined): string[] {
  if (allowed == null || allowed.trim() === '') return ['*']
  const s = allowed.trim()
  if (s === '*') return ['*']
  return s.split(',').map(p => p.trim()).filter(p => p.length > 0)
}

function isLoopbackEquivalent(allowed: string, requestOrigin: string): boolean {
  try {
    const a = new URL(allowed)
    const b = new URL(requestOrigin)
    if (a.protocol !== b.protocol) return false
    if ((a.port || defPort(a.protocol)) !== (b.port || defPort(b.protocol))) return false
    const ha = a.hostname
    const hb = b.hostname
    if (ha === hb) return true
    if ((ha === 'localhost' && hb === '127.0.0.1') || (ha === '127.0.0.1' && hb === 'localhost')) {
      return true
    }
    return false
  } catch {
    return false
  }
}

function defPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80'
}

/**
 * @returns The value to set for `Access-Control-Allow-Origin`, or `null` to omit (deny).
 */
export function resolveCorsAllowOrigin(allowed: string | undefined, requestOrigin: string): string | null {
  const parts = parseAllowedOrigins(allowed)
  if (parts.includes('*')) {
    // Reflect * only when we don't need to pair with credentials; this server uses credentials: true
    // in the UI. Using * with credentials is invalid; callers typically pass a concrete origin in dev.
    // Keep wildcard for tools / curl when no browser Origin is sent.
    return '*'
  }
  if (parts.length === 0) return '*'

  if (!requestOrigin) {
    // curl / SSR: mirror first allowed origin for same behavior as a fixed string header
    return parts[0]
  }

  for (const a of parts) {
    if (a === requestOrigin) return requestOrigin
    if (isLoopbackEquivalent(a, requestOrigin)) return requestOrigin
  }
  return null
}
