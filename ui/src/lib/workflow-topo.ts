/**
 * 与 blino 服务端 DAGEngine 同序的 Kahn 拓扑，用于在 UI 中排列 DAG 节点。
 */
export function topologicalNodeIds(
  nodes: Array<{ id: string; dependsOn: string[] }>,
): string[] {
  if (!nodes.length) return []
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
  for (const [id, deg] of Array.from(inDegree.entries())) {
    if (deg === 0) queue.push(id)
  }
  queue.sort()
  const out: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    if (!idToNode.has(id)) return nodes.map(n => n.id)
    out.push(id)
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
    return nodes.map(n => n.id)
  }
  return out
}
