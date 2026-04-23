/**
 * Build a simple left-to-right flowchart from workflow phases for Mermaid.
 * Node ids are P0, P1, ... so we can highlight the active step with `class P{n} wfCurrent`.
 */
export function buildPhasesFlowchartMermaid(
  phases: Array<{ id: string }>,
  activeIndex: number,
): string {
  if (!phases.length) return ''
  const n = phases.length
  const safe = (i: number) => {
    const raw = phases[i]?.id?.trim() || `step${i}`
    return raw.replace(/"/g, "'").slice(0, 80)
  }
  const ai = Math.min(Math.max(0, activeIndex), n - 1)
  const lines: string[] = ['flowchart LR']
  for (let i = 0; i < n; i++) {
    const label = i === ai ? `▶ ${safe(i)}` : safe(i)
    lines.push(`  P${i}["${label}"]`)
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
