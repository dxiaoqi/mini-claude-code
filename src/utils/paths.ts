/**
 * Blino 根目录名（$HOME 与项目根下各一层）。
 * 测试或隔离环境可设 `BLINO_DIR_NAME`（如 `.blino-test`）。
 */
export function getBlinoDir(): string {
  const v = process.env.BLINO_DIR_NAME?.trim()
  return v && v.length > 0 ? v : '.blino'
}

export const WORKFLOW_FILE = 'workflow.json' as const
