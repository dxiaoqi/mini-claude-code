/**
 * 子 Agent / workflow 内 AgentTool 排查：设 BLINO_DEBUG_SUBAGENT=1 输出到 stderr
 */
function enabled(): boolean {
  const v = process.env.BLINO_DEBUG_SUBAGENT
  if (!v) return false
  const s = String(v).toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

export function isSubagentDebugEnabled(): boolean {
  return enabled()
}

export function logSubagentDebug(agentId: string, ...args: unknown[]): void {
  if (!enabled()) return
  // eslint-disable-next-line no-console
  console.error(`[blino:subagent ${agentId}]`, ...args)
}
