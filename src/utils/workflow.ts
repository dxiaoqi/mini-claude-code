/**
 * 项目级 workflow 策略：`<project>/.blino/workflow.json`
 * 与 settings 合并后写入 Settings.projectPolicy（见 loadSettings）。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { getBlinoDir, WORKFLOW_FILE } from './paths.js'
import type { ProjectWorkflowPolicy, Settings } from '../types.js'

export type { ProjectWorkflowPolicy }

const phaseSchema = z.object({
  id: z.string().min(1),
  notes: z.string().optional(),
  activateSkillPacks: z.array(z.string()).optional(),
})

const evaluationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['script', 'file_exists']),
  spec: z.record(z.unknown()).default({}),
})

const teamSchema = z.object({
  topology: z.enum(['sequential', 'coordinator']).optional(),
  roles: z.array(z.object({
    id: z.string().min(1),
    toolProfile: z.string().optional(),
  })).optional(),
})

const workflowFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  profile: z.string().min(1).default('default'),
  /** Optional Mermaid diagram source for UI (e.g. flowchart). If omitted, UI derives a simple LR flow from phases. */
  mermaid: z.string().optional(),
  phases: z.array(phaseSchema).optional(),
  evaluation: z.array(evaluationSchema).optional(),
  team: teamSchema.optional(),
})

export function getWorkflowPath(projectRoot: string): string {
  return resolve(projectRoot, getBlinoDir(), WORKFLOW_FILE)
}

/**
 * 读取并校验 workflow.json。文件不存在时返回 { policy: null }；
 * 无效 JSON 或 schema 不符时打警告并返回 { policy: null, error }。
 */
export async function loadWorkflowPolicy(projectRoot: string): Promise<{
  policy: ProjectWorkflowPolicy | null
  error?: string
}> {
  const path = getWorkflowPath(projectRoot)
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return { policy: null }
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { policy: null, error: `Invalid JSON: ${msg}` }
  }
  const parsed = workflowFileSchema.safeParse(data)
  if (!parsed.success) {
    return {
      policy: null,
      error: parsed.error.issues.map(i => `${i.path.join('.') || 'root'}: ${i.message}`).join('; '),
    }
  }
  return { policy: parsed.data as unknown as ProjectWorkflowPolicy }
}

/**
 * 将校验后的 project policy 合入 Settings（不覆盖 settings 中已有同名字段，当前仅增加 projectPolicy）。
 */
export function mergeSettingsWithPolicy(
  base: Settings,
  policy: ProjectWorkflowPolicy | null,
): Settings {
  if (!policy) return base
  return { ...base, projectPolicy: policy }
}
