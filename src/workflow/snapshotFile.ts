/**
 * 工作流运行快照落盘：~/.blino/projects/<hash>/snapshot.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { BLINO_USER_SUB, resolveUserBlinoPath } from '../constants/blinoPaths.js'
import type { AgentSnapshot, WorkflowNodeSnapshot, WorkflowSnapshotFile } from './types.js'

function projectPathHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

/** 旧版单文件（无 runId 时曾使用） */
export function getWorkflowSnapshotFilePath(projectRoot: string): string {
  const hash = projectPathHash(projectRoot)
  return resolveUserBlinoPath(BLINO_USER_SUB.projects, hash, BLINO_USER_SUB.workflowSnapshotFile)
}

/** 按 runId 分文件，避免多实例互相覆盖 */
export function getWorkflowSnapshotFilePathForRun(projectRoot: string, runId: string): string {
  const hash = projectPathHash(projectRoot)
  const name = `workflow-run-${runId}.json`
  return resolveUserBlinoPath(BLINO_USER_SUB.projects, hash, name)
}

export async function writeWorkflowSnapshotFile(
  projectRoot: string,
  data: Omit<WorkflowSnapshotFile, 'version'> & { version?: 1 },
): Promise<string> {
  const runId = data.runSessionId
  const path = runId
    ? getWorkflowSnapshotFilePathForRun(projectRoot, runId)
    : getWorkflowSnapshotFilePath(projectRoot)
  const full: WorkflowSnapshotFile = {
    version: 1,
    ...data,
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(full, null, 2) + '\n', 'utf-8')
  return path
}

export function buildSnapshotPayload(
  workflowId: string,
  runSessionId: string,
  projectRoot: string,
  nodes: Record<string, WorkflowNodeSnapshot>,
  subAgentSnapshots?: Record<string, AgentSnapshot>,
): WorkflowSnapshotFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    workflowId,
    runSessionId,
    projectRoot,
    nodes,
    ...(subAgentSnapshots && Object.keys(subAgentSnapshots).length > 0
      ? { subAgentSnapshots }
      : {}),
  }
}

/**
 * 读取已落盘的工作流快照（断点续跑、UI 恢复子 agent 态）
 * 若文件不存在或解析失败，返回 null
 */
/**
 * 读取快照：若提供 `runId` 只读 `workflow-run-<runId>.json`（**不回退**到 legacy
 * `snapshot.json`），避免新 run 的 uuid 在文件尚未创建时误恢复旧任务进度。未给 `runId` 时仍只读
 * legacy 路径（旧版/测试兼容）。
 */
export async function readWorkflowSnapshotFile(
  projectRoot: string,
  runId?: string,
): Promise<WorkflowSnapshotFile | null> {
  const tryRead = async (path: string): Promise<WorkflowSnapshotFile | null> => {
    try {
      const raw = await readFile(path, 'utf-8')
      const data = JSON.parse(raw) as WorkflowSnapshotFile
      if (data?.version !== 1 || !data.nodes) return null
      return data
    } catch {
      return null
    }
  }
  if (runId) {
    return tryRead(getWorkflowSnapshotFilePathForRun(projectRoot, runId))
  }
  return tryRead(getWorkflowSnapshotFilePath(projectRoot))
}
