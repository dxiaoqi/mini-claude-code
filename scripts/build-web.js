/**
 * build-web.js — builds the Next.js UI in standalone mode and copies
 * the self-contained server to ui-standalone/ for npm packaging.
 *
 * Output structure (included in npm package):
 *   ui-standalone/
 *     server.js          ← entry: node ui-standalone/server.js
 *     .next/             ← compiled pages & static assets
 *     node_modules/      ← minimal runtime deps (~15-20 MB)
 *     public/            ← static public assets (if any)
 */

import { execSync } from 'node:child_process'
import { cpSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')
const uiDir = resolve(root, 'ui')
const outDir = resolve(root, 'ui-standalone')

console.log('🔨 Building Next.js UI (standalone mode)…')
console.log('   This takes ~30-60 s on first run.\n')

// Build Next.js
execSync('npm run build', { cwd: uiDir, stdio: 'inherit' })

const standaloneSource = resolve(uiDir, '.next', 'standalone')
if (!existsSync(standaloneSource)) {
  console.error('✗ .next/standalone not found — ensure next.config has output: "standalone"')
  process.exit(1)
}

// Clean previous build
if (existsSync(outDir)) {
  console.log('\n🗑  Cleaning previous ui-standalone…')
  rmSync(outDir, { recursive: true })
}

// Copy standalone server
console.log('📦 Copying standalone server…')
cpSync(standaloneSource, outDir, { recursive: true })

// Next.js standalone doesn't include static files — copy them in
const staticSrc = resolve(uiDir, '.next', 'static')
const staticDest = resolve(outDir, '.next', 'static')
if (existsSync(staticSrc)) {
  cpSync(staticSrc, staticDest, { recursive: true })
}

// Copy public assets
const publicSrc = resolve(uiDir, 'public')
const publicDest = resolve(outDir, 'public')
if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDest, { recursive: true })
}

console.log('\n✅ Web UI built → ui-standalone/')
console.log('   Run with: node ui-standalone/server.js')
