/**
 * 项目 `.blino/workflow.json` 解析与合入 Settings。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { BLINO_DIR } from './paths.js'
import type { ProjectWorkflowPolicy, Settings } from '../types.js'

export const WORKFLOW_FILE = 'workflow.json' as const

const phaseSchema = z.object({
  id: z.string().min(1),
  notes: z.string().optional(),
  activateSkillPacks: z.array(z.string()).optional(),
})

const workflowFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  profile: z.string().min(1).default('default'),
  mermaid: z.string().optional(),
  phases: z.array(phaseSchema).optional(),
})

export function getWorkflowPath(projectRoot: string): string {
  return resolve(projectRoot, BLINO_DIR, WORKFLOW_FILE)
}

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

export function mergeSettingsWithPolicy(
  base: Settings,
  policy: ProjectWorkflowPolicy | null,
): Settings {
  if (!policy) return base
  return { ...base, projectPolicy: policy }
}
