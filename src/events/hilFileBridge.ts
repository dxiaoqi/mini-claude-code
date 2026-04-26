/**
 * 通过用户主目录下 Blino hil/<sessionId> 把跨进程 CLI 信令转交到进程内 eventBus（hil_resume / hil_suspend）。
 */
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { watchFile, unwatchFile, existsSync } from 'node:fs'
import type { SessionState } from '../types.js'
import { eventBus } from './EventBus.js'
import { BLINO_USER_SUB, joinUserBlinoPath } from '../constants/blinoPaths.js'

export function getHilSessionFilePath(sessionId: string): string {
  return joinUserBlinoPath(BLINO_USER_SUB.hil, sessionId)
}

/** CLI「另一终端」：写入与主进程同 sessionId 对应的文件。 */
export async function writeHilSignalFromCli(eventLine: string, sessionId: string): Promise<void> {
  const dir = joinUserBlinoPath(BLINO_USER_SUB.hil)
  await mkdir(dir, { recursive: true })
  const file = getHilSessionFilePath(sessionId)
  const line = `${eventLine.trim()}\n${Date.now()}\n`
  await writeFile(file, line, 'utf-8')
}

/**
 * 主进程在会话开始监听当前 session 文件；与 writeHilSignalFromCli 配对。
 * 每行首词为事件名，当前支持 hil_resume、hil_suspend。
 */
export function startHilFileBridge(
  state: SessionState,
  onLog: (line: string) => void = () => {},
): () => void {
  const file = getHilSessionFilePath(state.sessionId)
  const dir = joinUserBlinoPath(BLINO_USER_SUB.hil)
  if (!existsSync(dir)) {
    void mkdir(dir, { recursive: true })
  }
  if (!existsSync(file)) {
    void writeFile(file, '', 'utf-8')
  }

  const handle = async (): Promise<void> => {
    let raw: string
    try {
      raw = await readFile(file, 'utf-8')
    } catch {
      return
    }
    const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? ''
    if (!firstLine) return
    if (firstLine === 'hil_resume' || firstLine === 'resume') {
      onLog(`[hil] file → hil_resume for ${state.sessionId}`)
      eventBus.emit('hil_resume', { id: state.sessionId })
    } else if (firstLine === 'hil_suspend' || firstLine === 'suspend') {
      onLog(`[hil] file → hil_suspend for ${state.sessionId}`)
      state.hilPending = true
      eventBus.emit('hil_suspend', { id: state.sessionId })
    } else {
      return
    }
    // 消费，避免 watch 重复触发
    await writeFile(file, '', 'utf-8')
  }

  const debounce = { t: null as ReturnType<typeof setTimeout> | null }
  const onChange = (): void => {
    if (debounce.t) clearTimeout(debounce.t)
    debounce.t = setTimeout(() => {
      void handle()
    }, 20)
  }

  void handle()
  watchFile(file, { interval: 200 }, onChange)
  return () => {
    if (debounce.t) clearTimeout(debounce.t)
    unwatchFile(file, onChange)
  }
}
