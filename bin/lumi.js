#!/usr/bin/env node
/**
 * lumi — global CLI entry point
 * 
 * Dev mode:  runs tsx src/cli.ts (auto-detected when dist/ doesn't exist)
 * Prod mode: runs dist/cli.js (after npm run build)
 */

import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')

const distCli = resolve(root, 'dist', 'cli.js')
const srcCli = resolve(root, 'src', 'cli.ts')

const args = process.argv.slice(2)

if (existsSync(distCli)) {
  // Production: use compiled JS
  const child = spawn(process.execPath, [distCli, ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  })
  child.on('exit', code => process.exit(code ?? 0))
} else {
  // Development: use tsx
  const tsxBin = resolve(root, 'node_modules', '.bin', 'tsx')
  const runner = existsSync(tsxBin) ? tsxBin : 'tsx'
  
  const child = spawn(runner, [srcCli, ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  })
  child.on('exit', code => process.exit(code ?? 0))
}
