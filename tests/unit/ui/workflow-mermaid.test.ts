import { describe, it, expect } from 'vitest'
import { buildPhasesFlowchartMermaid } from '../../../ui/src/lib/workflow-mermaid'

describe('buildPhasesFlowchartMermaid', () => {
  it('uses stadium () nodes and no arrow in label', () => {
    const s = buildPhasesFlowchartMermaid(
      [{ id: 'A' }, { id: 'B' }],
      0,
    )
    expect(s).toContain('P0(A)')
    expect(s).toContain('P1(B)')
    expect(s).toContain('P0 --> P1')
    expect(s).not.toContain('▶')
  })
})
