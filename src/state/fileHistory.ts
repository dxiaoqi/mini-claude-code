/**
 * state/fileHistory.ts — 文件修改快照与撤销
 *
 * 在编辑前保存快照，支持 /undo 等路径从磁盘恢复快照内容。
 */
import { readFile, writeFile, mkdir, stat, readdir, rm } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import type { SessionState } from '../types.js'
import { BLINO_DIR } from '../utils/paths.js'

interface FileSnapshot {
  filePath: string
  content: string
  timestamp: string
  toolName: string
}

const snapshots: Map<string, FileSnapshot[]> = new Map()

/**
 * Get the snapshot directory for the session.
 */
function getSnapshotDir(state: SessionState): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp'
  return resolve(homeDir, BLINO_DIR, 'snapshots', state.sessionId)
}

/**
 * Take a snapshot of a file before modification.
 * Call this before any file edit/write operation.
 */
export async function takeSnapshot(
  state: SessionState,
  filePath: string,
  toolName: string,
): Promise<void> {
  try {
    const s = await stat(filePath)
    if (!s.isFile()) return

    const content = await readFile(filePath, 'utf-8')
    const snapshot: FileSnapshot = {
      filePath,
      content,
      timestamp: new Date().toISOString(),
      toolName,
    }

    const existing = snapshots.get(filePath) || []
    existing.push(snapshot)
    snapshots.set(filePath, existing)

    // Also persist to disk
    const snapshotDir = getSnapshotDir(state)
    await mkdir(snapshotDir, { recursive: true })

    const safeFileName = filePath.replace(/[/\\:]/g, '_')
    const snapshotPath = resolve(snapshotDir, `${safeFileName}.${existing.length}.snapshot`)
    await writeFile(snapshotPath, content, 'utf-8')
  } catch {
    // File doesn't exist yet (new file) — no snapshot needed
  }
}

/**
 * Restore a file to its previous state (undo last modification).
 */
export async function restoreSnapshot(
  state: SessionState,
  filePath: string,
): Promise<{ success: boolean; message: string }> {
  const fileSnapshots = snapshots.get(filePath)

  if (!fileSnapshots || fileSnapshots.length === 0) {
    return { success: false, message: `No snapshots available for: ${filePath}` }
  }

  const latest = fileSnapshots.pop()!

  try {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, latest.content, 'utf-8')
    return {
      success: true,
      message: `Restored ${filePath} to snapshot from ${latest.timestamp} (before ${latest.toolName})`,
    }
  } catch (err) {
    return { success: false, message: `Failed to restore: ${(err as Error).message}` }
  }
}

/**
 * Get the number of available snapshots for a file.
 */
export function getSnapshotCount(filePath: string): number {
  return snapshots.get(filePath)?.length || 0
}

/**
 * List all files that have snapshots.
 */
export function listSnapshotFiles(): Array<{ filePath: string; count: number; latestTimestamp: string }> {
  const result: Array<{ filePath: string; count: number; latestTimestamp: string }> = []

  for (const [filePath, fileSnapshots] of snapshots) {
    if (fileSnapshots.length > 0) {
      result.push({
        filePath,
        count: fileSnapshots.length,
        latestTimestamp: fileSnapshots[fileSnapshots.length - 1].timestamp,
      })
    }
  }

  return result
}

/**
 * Clear all snapshots (called on /clear).
 */
export function clearSnapshots(): void {
  snapshots.clear()
}

/**
 * Clean up snapshot files from disk.
 */
export async function cleanupSnapshots(state: SessionState): Promise<void> {
  try {
    const snapshotDir = getSnapshotDir(state)
    await rm(snapshotDir, { recursive: true, force: true })
  } catch {
    // Ignore
  }
}
