/**
 * --tui: derive browser-facing URLs, CORS allow list, and safe URLs for `xdg-open`.
 */

import { isIPv4 } from 'node:net'
import { networkInterfaces } from 'node:os'

const LOOPBACKS = new Set(['0.0.0.0', '::', '::0', '*'])

/** Non-internal IPv4s (e.g. LAN) for server bind 0.0.0.0. */
export function getLanIPv4Addresses(): string[] {
  const n = networkInterfaces()
  const out: string[] = []
  for (const ifaces of Object.values(n)) {
    for (const i of ifaces || []) {
      if (i.internal) continue
      if (isIPv4(i.address)) {
        out.push(i.address)
      }
    }
  }
  return [...new Set(out)]
}

function origin(httpHost: string, port: number): string {
  return `http://${httpHost}:${port}`
}

/** Whether the process listens on all interfaces (treat 0.0.0.0 / :: the same for URL hints). */
export function isBindAll(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '::0'
}

/**
 * Comma-separated CORS `Access-Control-Allow-Origin` sources for tui: dev localhost pairs,
 * explicit `--host` when not bind-all, LAN IPs for remote UI when bind-all, plus env extras.
 */
export function buildTuiCorsOrigins(
  serveHost: string,
  uiPort: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const extraRaw = (env.BLINO_CORS_EXTRA || env.BLINO_PUBLIC_UI_ORIGINS || '').trim()
  const extra = extraRaw
    ? extraRaw.split(',').map(s => s.trim()).filter(s => s.length > 0)
    : []
  const set = new Set<string>()

  for (const s of extra) {
    if (s !== '*') set.add(s)
  }

  for (const h of ['localhost', '127.0.0.1']) {
    set.add(origin(h, uiPort))
  }

  if (!isBindAll(serveHost)) {
    if (serveHost && serveHost !== 'localhost' && serveHost !== '127.0.0.1') {
      set.add(origin(serveHost, uiPort))
    }
  } else {
    for (const ip of getLanIPv4Addresses()) {
      set.add(origin(ip, uiPort))
    }
  }

  if (set.size === 0) {
    return origin('localhost', uiPort)
  }
  return [...set].join(',')
}

/**
 * API base URL the browser will use (NEXT_PUBLIC_BLINO_URL / BLINO_API_URL). When the server
 * binds 0.0.0.0, prefer BLINO_PUBLIC_API_URL, else first LAN IP so another machine on the LAN
 * can open the UI and reach the same host:port. Same-machine-only: still works via LAN IP in most home nets.
 */
export function buildTuiPublicApiBaseUrl(serveHost: string, servePort: number, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env.BLINO_PUBLIC_API_URL || env.NEXT_PUBLIC_BLINO_URL || '').trim()
  if (explicit) {
    return explicit.replace(/\/$/, '')
  }
  if (!isBindAll(serveHost)) {
    if (serveHost && !LOOPBACKS.has(serveHost)) {
      return origin(serveHost, servePort)
    }
  }
  const lans = getLanIPv4Addresses()
  if (lans.length > 0) {
    return origin(lans[0], servePort)
  }
  return origin('127.0.0.1', servePort)
}

/**
 * Open in browser: never `http://0.0.0.0:port` (invalid). Prefer loopback.
 */
export function buildTuiBrowserUrl(host: string, port: number): string {
  if (isBindAll(host) || !host) {
    return origin('127.0.0.1', port)
  }
  return origin(host, port)
}
