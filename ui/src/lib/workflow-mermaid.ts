/**
 * Build a simple left-to-right flowchart (draw.io–like: round stadium nodes, no ▶ in label — active state = SVG styling + tooltip).
 * Node ids P0, P1... match post-process in WorkflowMermaidDiagram.
 */
export function buildPhasesFlowchartMermaid(
  phases: Array<{ id: string }>,
  _activeIndex: number,
): string {
  if (!phases.length) return ''
  const n = phases.length
  const safe = (i: number) => {
    const raw = phases[i]?.id?.trim() || `step${i}`
    return raw.replace(/"/g, "'").slice(0, 32)
  }
  const lines: string[] = ['%% Blino auto: stadium nodes, tooltips in UI from phases', 'flowchart LR']
  for (let i = 0; i < n; i++) {
    // (label) = stadium / pill shape, closer to draw.io "rounded" blocks
    lines.push(`  P${i}(${safe(i)})`)
  }
  for (let i = 0; i < n - 1; i++) {
    lines.push(`  P${i} --> P${i + 1}`)
  }
  return lines.join('\n')
}

/** Cap size to avoid huge payloads in the browser. */
export function isReasonableMermaidSource(s: string): boolean {
  return s.length > 0 && s.length <= 24_000
}
