/**
 * postbuild.js — runs after `tsc` to finish the backend build.
 * - Makes dist/cli.js executable on Unix systems
 */

import { chmodSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')
const cliPath = resolve(root, 'dist', 'cli.js')

if (existsSync(cliPath) && process.platform !== 'win32') {
  chmodSync(cliPath, 0o755)
  console.log('✓ dist/cli.js marked executable')
}
