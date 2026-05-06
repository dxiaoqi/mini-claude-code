/**
 * GET /api/blino-config
 * Returns project-level blino config (.blino/config.json) for the UI.
 * Reads from the filesystem server-side so it works regardless of NEXT_PUBLIC_BLINO_URL.
 * Falls back to proxying BLINO_API_URL/api/config if the file is not found.
 */

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET() {
  // 1. Try reading .blino/config.json relative to the project root.
  //    In dev: process.cwd() = ui/  → go up one level to project root.
  //    In standalone: process.cwd() = package root → same structure.
  const candidates = [
    path.join(process.cwd(), '..', '.blino', 'config.json'),
    path.join(process.cwd(), '.blino', 'config.json'),
  ]

  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf-8')
      const config = JSON.parse(raw)
      return NextResponse.json(config)
    } catch {
      // try next candidate
    }
  }

  // 2. Fallback: proxy to blino backend
  const blinoUrl = process.env.BLINO_API_URL || process.env.NEXT_PUBLIC_BLINO_URL || 'http://localhost:3001'
  try {
    const res = await fetch(`${blinoUrl}/api/config`, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      return NextResponse.json({ renderer: data.renderer ?? null })
    }
  } catch {
    // ignore
  }

  return NextResponse.json({})
}
