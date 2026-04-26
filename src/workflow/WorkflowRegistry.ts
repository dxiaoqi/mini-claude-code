/**
 * 从项目 .blino/workflows/ 加载工作流定义，内存注册表 + 失效刷新
 */
import { readdir, readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { BLINO_PROJECT_SUB, resolveProjectBlinoPath } from '../constants/blinoPaths.js'
import type { WorkflowDef } from './types.js'

const NodeDefSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  // 不 default([])：与「省略」相区别——省略=未指定(全量)；[] = 无工具(仅文本)
  allowedTools: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional().default([]),
  hilRequired: z.boolean().optional().default(false),
})

const WorkflowInputSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'select', 'date']),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  default: z.string().optional(),
  required: z.boolean(),
})

const WorkflowDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  inputs: z.array(WorkflowInputSchema).optional(),
  nodes: z.array(NodeDefSchema).min(1),
})

function parseContent(raw: string, path: string): unknown {
  const ext = extname(path).toLowerCase()
  if (ext === '.json') {
    return JSON.parse(raw) as unknown
  }
  if (ext === '.yaml' || ext === '.yml') {
    return parseYaml(raw) as unknown
  }
  throw new Error(`Unsupported workflow extension: ${ext}`)
}

function validateDef(data: unknown, source: string): WorkflowDef {
  const r = WorkflowDefSchema.safeParse(data)
  if (!r.success) {
    const msg = r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid workflow ${source}: ${msg}`)
  }
  const w = r.data
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    inputs: w.inputs?.map(i => ({ ...i })),
    nodes: w.nodes.map(n => ({
      id: n.id,
      prompt: n.prompt,
      allowedTools: n.allowedTools,
      dependsOn: n.dependsOn,
      hilRequired: n.hilRequired,
    })),
  }
}

/**
 * 校验 id 在节点、dependsOn 中一致且无环前由 DAGEngine 做拓扑
 */
function validateGraph(def: WorkflowDef): void {
  const ids = new Set<string>()
  for (const n of def.nodes) {
    if (ids.has(n.id)) {
      throw new Error(`Workflow "${def.id}": duplicate node id "${n.id}"`)
    }
    ids.add(n.id)
  }
  for (const n of def.nodes) {
    for (const d of n.dependsOn) {
      if (!ids.has(d)) {
        throw new Error(`Workflow "${def.id}": node "${n.id}" depends on unknown node "${d}"`)
      }
    }
  }
  if (def.id.length < 1) throw new Error('Workflow id required')
}

export class WorkflowRegistry {
  private readonly defs = new Map<string, WorkflowDef>()

  register(def: WorkflowDef): void {
    validateGraph(def)
    this.defs.set(def.id, def)
  }

  get(id: string): WorkflowDef | undefined {
    return this.defs.get(id)
  }

  list(): WorkflowDef[] {
    return [...this.defs.values()]
  }

  invalidate(): void {
    this.defs.clear()
  }

  /**
   * 扫描 <projectRoot>/.blino/workflows/ 下 .json / .yml / .yaml，合并到注册表
   */
  async loadFromProject(projectRoot: string): Promise<void> {
    const dir = resolveProjectBlinoPath(projectRoot, BLINO_PROJECT_SUB.workflows)
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (!/\.(json|ya?ml)$/i.test(name)) continue
      const filePath = resolve(dir, name)
      let raw: string
      try {
        raw = await readFile(filePath, 'utf-8')
      } catch {
        continue
      }
      try {
        const parsed = parseContent(raw, filePath)
        const def = validateDef(parsed, name)
        validateGraph(def)
        this.register(def)
      } catch (e) {
        console.warn(`[workflow] skip ${name}: ${(e as Error).message}`)
      }
    }
  }
}

let globalRegistry: WorkflowRegistry | null = null

export function getWorkflowRegistry(): WorkflowRegistry {
  if (!globalRegistry) globalRegistry = new WorkflowRegistry()
  return globalRegistry
}

/**
 * 重新加载并返回 registry（同进程单例）
 */
export async function loadWorkflowRegistry(projectRoot: string): Promise<WorkflowRegistry> {
  const r = getWorkflowRegistry()
  r.invalidate()
  await r.loadFromProject(projectRoot)
  return r
}
