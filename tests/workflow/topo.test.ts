import { describe, it, expect } from 'vitest'
import { topologicalOrder } from '../../src/workflow/topo.js'
import type { NodeDef } from '../../src/workflow/types.js'

function n(p: Partial<NodeDef> & { id: string; prompt: string }): NodeDef {
  return {
    id: p.id,
    prompt: p.prompt,
    allowedTools: p.allowedTools,
    dependsOn: p.dependsOn ?? [],
    hilRequired: p.hilRequired ?? false,
  }
}

describe('workflow topo', () => {
  it('orders dependencies before dependents', () => {
    const o = topologicalOrder([
      n({ id: 'b', prompt: 'x', dependsOn: ['a'] }),
      n({ id: 'a', prompt: 'x' }),
    ])
    expect(o.map(x => x.id).join('')).toBe('ab')
  })
})
