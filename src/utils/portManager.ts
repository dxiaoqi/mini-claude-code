/**
 * utils/portManager.ts — 端口管理器
 *
 * 解决多 workspace 同时运行 --tui 时的端口冲突问题：
 *   1. 自动探测可用端口（从默认端口开始向上扫描）
 *   2. 在 .lino/server.json 写入锁文件（记录 pid + port + cwd）
 *   3. 启动时检查锁文件：若同一 workspace 已有实例运行则复用（直接打开浏览器）
 *   4. 进程退出时自动清理锁文件
 */

import { createServer } from 'node:net'
import { writeFile, readFile, mkdir, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface ServerLockInfo {
  pid: number
  port: number
  host: string
  cwd: string
  startedAt: string
}

const LOCK_FILE_NAME = 'server.json'

// ── 端口探测 ──────────────────────────────────────────────────────────────────

/**
 * 检测指定端口是否空闲
 */
export function isPortFree(port: number, host = 'localhost'): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

/**
 * 从 startPort 开始向上扫描，找到第一个空闲端口。
 * 最多尝试 maxTries 个端口（默认 20）。
 */
export async function findAvailablePort(
  startPort: number,
  host = 'localhost',
  maxTries = 20,
): Promise<number> {
  for (let p = startPort; p < startPort + maxTries; p++) {
    if (await isPortFree(p, host)) {
      return p
    }
  }
  throw new Error(
    `No available port found in range ${startPort}–${startPort + maxTries - 1}. ` +
    `Use --port <N> to specify a different starting port.`,
  )
}

// ── Workspace 锁文件 ─────────────────────────────────────────────────────────

function getLockFilePath(cwd: string): string {
  return resolve(cwd, '.lino', LOCK_FILE_NAME)
}

/**
 * 写入当前 workspace 的服务器锁文件。
 * 进程退出时应调用 clearServerLock 清理。
 */
export async function writeServerLock(
  cwd: string,
  port: number,
  host: string,
): Promise<void> {
  const info: ServerLockInfo = {
    pid: process.pid,
    port,
    host,
    cwd,
    startedAt: new Date().toISOString(),
  }
  const path = getLockFilePath(cwd)
  await mkdir(resolve(cwd, '.lino'), { recursive: true })
  await writeFile(path, JSON.stringify(info, null, 2) + '\n', 'utf-8')
}

/**
 * 读取 workspace 的服务器锁文件。
 * 返回 null 表示没有或已失效。
 */
export async function readServerLock(cwd: string): Promise<ServerLockInfo | null> {
  try {
    const raw = await readFile(getLockFilePath(cwd), 'utf-8')
    const info = JSON.parse(raw) as ServerLockInfo

    // 检查 PID 是否仍然存活
    if (!isPidAlive(info.pid)) {
      // 旧锁文件，清理掉
      await clearServerLock(cwd).catch(() => {})
      return null
    }

    // 检查端口是否仍然被占用（确认服务在跑）
    const free = await isPortFree(info.port, info.host)
    if (free) {
      await clearServerLock(cwd).catch(() => {})
      return null
    }

    return info
  } catch {
    return null
  }
}

/**
 * 清理 workspace 的服务器锁文件。
 */
export async function clearServerLock(cwd: string): Promise<void> {
  await unlink(getLockFilePath(cwd)).catch(() => {})
}

/**
 * 注册进程退出时的自动清理。
 */
export function registerLockCleanup(cwd: string): void {
  const cleanup = () => {
    // 同步删除（process.exit 时不能用 async）
    try {
      const { unlinkSync } = require('node:fs')
      unlinkSync(getLockFilePath(cwd))
    } catch { /* ignore */ }
  }

  process.on('exit', cleanup)
  process.on('SIGINT', () => { cleanup(); process.exit(0) })
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })
}

// ── 辅助 ─────────────────────────────────────────────────────────────────────

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
