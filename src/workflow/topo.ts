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
