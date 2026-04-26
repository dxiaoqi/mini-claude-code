/**
 * Blino 数据目录与配置文件路径约定（用户主目录与项目根下统一根名）。
 * 改目录名时只调此处与下方片段常量即可。
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** 主目录、项目根下统一使用的 Blino 根目录名（如 `.blino`） */
export const BLINO_DIR_NAME = '.blino' as const

/** `~/.blino` 在文档与 CLI 提示中的展示前缀 */
export const BLINO_TILDE_ROOT = `~/${BLINO_DIR_NAME}` as const

/** 用户主目录下 ~/.blino/ 内子目录/文件名 */
export const BLINO_USER_SUB = {
  projects: 'projects',
  memory: 'memory',
  skills: 'skills',
  hil: 'hil',
  snapshots: 'snapshots',
  overflow: 'overflow',
  memoryFile: 'memory.json',
  /** 与 transcript 同级的 projects/<hash>/ 下，工作流运行快照 */
  workflowSnapshotFile: 'snapshot.json',
} as const

/** 项目根下 .blino/ 内子目录 */
export const BLINO_PROJECT_SUB = {
  skills: 'skills',
  artifacts: 'artifacts',
  /** 工作流定义文件（.json / .yaml） */
  workflows: 'workflows',
  /** 用户自定义工具（.json HTTP / .tool.js 脚本） */
  tools: 'tools',
} as const

export const BLINO_CONFIG_FILE = {
  settings: 'settings.json',
  settingsLocal: 'settings.local.json',
  serverLock: 'server.json',
} as const

/** 与历史逻辑一致：HOME / USERPROFILE / os.homedir() / /tmp */
export function getUserHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir() || '/tmp'
}

/** 解析为绝对路径：用户主目录下的 Blino 根 / 或更深路径，如 ~/.blino/projects/... */
export function resolveUserBlinoPath(...segments: string[]): string {
  return resolve(getUserHomeDir(), BLINO_DIR_NAME, ...segments)
}

/** 解析为绝对路径：项目根下的 <projectRoot>/.blino/... */
export function resolveProjectBlinoPath(projectRoot: string, ...segments: string[]): string {
  return resolve(projectRoot, BLINO_DIR_NAME, ...segments)
}

/** 用 join 拼子路径（部分场景用 join 而非 resolve） */
export function joinUserBlinoPath(...segments: string[]): string {
  return join(getUserHomeDir(), BLINO_DIR_NAME, ...segments)
}
