import { watch } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Tool } from '../../types.js'
import { buildHttpTool } from './buildHttpTool.js'
import { buildScriptTool } from './buildScriptTool.js'
import type { UserToolHttpDef, UserToolScriptDef } from './types.js'

export class UserToolLoader {
  private toolsDir: string
  private tools: Map<string, Tool> = new Map()
  private watcher: ReturnType<typeof watch> | null = null
  private listeners: Set<() => void> = new Set()
  private reloadTimer: ReturnType<typeof setTimeout> | null = null

  constructor(toolsDir: string) {
    this.toolsDir = toolsDir
  }

  async start(): Promise<void> {
    await this.loadAll()
    this.startWatcher()
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    this.reloadTimer = null
  }

  getTools(): Tool[] {
    return [...this.tools.values()]
  }

  onChange(handler: () => void): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  private notify(): void {
    for (const h of this.listeners) {
      try {
        h()
      } catch {
        /* ignore */
      }
    }
  }

  private startWatcher(): void {
    try {
      this.watcher = watch(this.toolsDir, { recursive: false }, (_event, filename) => {
        if (!filename) return
        const ext = extname(filename.toString())
        if (!['.json', '.js', '.mjs'].includes(ext)) return
        if (this.reloadTimer) clearTimeout(this.reloadTimer)
        this.reloadTimer = setTimeout(async () => {
          await this.loadAll()
          this.notify()
        }, 300)
      })
    } catch {
      /* 目录不存在等 */
    }
  }

  private async loadAll(): Promise<void> {
    this.tools.clear()
    let files: string[]
    try {
      files = await readdir(this.toolsDir)
    } catch {
      return
    }

    for (const file of files) {
      const ext = extname(file)
      const filePath = join(this.toolsDir, file)
      try {
        if (ext === '.json') {
          await this.loadJsonTool(filePath)
        } else if (ext === '.js' || ext === '.mjs') {
          if (file.endsWith('.tool.js') || file.endsWith('.tool.mjs')) {
            await this.loadScriptTool(filePath)
          }
        }
      } catch (e) {
        console.warn(`[UserToolLoader] 加载工具失败 ${file}:`, (e as Error).message)
      }
    }
  }

  private async loadJsonTool(filePath: string): Promise<void> {
    const raw = await readFile(filePath, 'utf-8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const def = parsed as Partial<UserToolHttpDef>
    if (!def.name || !def.executor || def.executor.type !== 'http') return
    const tool = buildHttpTool(def as UserToolHttpDef)
    this.tools.set(def.name, tool)
  }

  private async loadScriptTool(filePath: string): Promise<void> {
    const url = pathToFileURL(filePath).href + `?t=${Date.now()}`
    const mod = await import(url)
    const def = (mod.default ?? mod) as Partial<UserToolScriptDef>
    if (!def.name || typeof def.execute !== 'function') return
    const tool = buildScriptTool(def as UserToolScriptDef)
    this.tools.set(def.name, tool)
  }
}
