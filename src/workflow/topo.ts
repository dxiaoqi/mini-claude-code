import type { NodeDef } from './types.js'

/** Kahn 拓扑：字典序稳定拉平入度为 0 的节点 */
export function topologicalOrder(nodes: NodeDef[]): NodeDef[] {
  const idToNode = new Map(nodes.map(n => [n.id, n]))
  const inDegree = new Map<string, number>()
  for (const n of nodes) {
    inDegree.set(n.id, n.dependsOn.length)
  }
  const children = new Map<string, string[]>()
  for (const n of nodes) {
    for (const d of n.dependsOn) {
      if (!children.has(d)) children.set(d, [])
      children.get(d)!.push(n.id)
    }
  }
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }
  queue.sort()
  const out: NodeDef[] = []
  while (queue.length) {
    const id = queue.shift()!
    const node = idToNode.get(id)
    if (!node) throw new Error(`Workflow: missing node "${id}"`)
    out.push(node)
    for (const down of children.get(id) || []) {
      const next = (inDegree.get(down) ?? 0) - 1
      inDegree.set(down, next)
      if (next === 0) {
        queue.push(down)
        queue.sort()
      }
    }
  }
  if (out.length !== nodes.length) {
    throw new Error('Workflow has a cycle or invalid dependencies')
  }
  return out
}

/**
 * 将节点按执行层（wave）分组：同一层内的节点互相无依赖，可并行执行。
 * 每层内节点按字典序排列保持稳定性。
 */
export function topologicalWaves(nodes: NodeDef[]): NodeDef[][] {
  const inDegree = new Map<string, number>()
  const children = new Map<string, string[]>()
  const idToNode = new Map(nodes.map(n => [n.id, n]))

  for (const n of nodes) {
    inDegree.set(n.id, n.dependsOn.length)
    for (const d of n.dependsOn) {
      if (!children.has(d)) children.set(d, [])
      children.get(d)!.push(n.id)
    }
  }

  const waves: NodeDef[][] = []
  let remaining = nodes.length

  while (remaining > 0) {
    const wave: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) wave.push(id)
    }
    if (wave.length === 0) {
      throw new Error('Workflow has a cycle or invalid dependencies')
    }
    wave.sort()
    waves.push(wave.map(id => idToNode.get(id)!))

    for (const id of wave) {
      inDegree.delete(id)
      for (const down of children.get(id) ?? []) {
        inDegree.set(down, (inDegree.get(down) ?? 0) - 1)
      }
      remaining--
    }
  }

  return waves
}

