import type { WorkflowEvent, WorkflowSummary } from './types'

export type RunningWorkflowInfo = { runId: string; workflowId: string }

const BLINO_SERVER = process.env.NEXT_PUBLIC_BLINO_URL || 'http://localhost:3001'

/** 拉取单个 workflow 的完整 nodeIds/nodes（与 list 同源；list 缺字段时可补全） */
export async function getWorkflowDetail(workflowId: string): Promise<WorkflowSummary | null> {
  try {
    const res = await fetch(
      `${BLINO_SERVER}/workflow/detail/${encodeURIComponent(workflowId)}`,
      { method: 'GET' },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { workflow?: WorkflowSummary }
    const w = data.workflow
    if (!w) return null
    return {
      ...w,
      nodeIds: w.nodeIds ?? [],
      inputs: w.inputs ?? [],
      nodes: w.nodes?.length
        ? w.nodes
        : (w.nodeIds ?? []).map(id => ({ id, dependsOn: [] as string[] })),
    }
  } catch {
    return null
  }
}

export async function listRunningWorkflows(): Promise<RunningWorkflowInfo[]> {
  try {
    const res = await fetch(`${BLINO_SERVER}/workflow/list-running`, { method: 'GET' })
    if (!res.ok) return []
    const data = (await res.json()) as { runs?: RunningWorkflowInfo[] }
    return data.runs ?? []
  } catch {
    return []
  }
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  try {
    const res = await fetch(`${BLINO_SERVER}/workflow/list`, { method: 'GET' })
    if (!res.ok) return []
    const data = (await res.json()) as { workflows?: WorkflowSummary[] }
    return (data.workflows ?? []).map(w => ({
      ...w,
      nodeIds: w.nodeIds ?? [],
      inputs: w.inputs ?? [],
      nodes: w.nodes?.length
        ? w.nodes
        : (w.nodeIds ?? []).map((id: string) => ({ id, dependsOn: [] as string[] })),
    }))
  } catch {
    return []
  }
}

export class WorkflowRunError extends Error {
  code: string
  runningId?: string
  constructor(message: string, code: string, runningId?: string) {
    super(message)
    this.name = 'WorkflowRunError'
    this.code = code
    this.runningId = runningId
  }
}

export async function runWorkflow(
  workflowId: string,
  sessionId: string,
  inputValues: Record<string, string> = {},
): Promise<string> {
  const res = await fetch(`${BLINO_SERVER}/workflow/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, sessionId, inputValues }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    runningId?: string
    runId?: string
    missing?: string[]
  }
  if (!res.ok) {
    if (res.status === 400 && data.error === 'missing_required_inputs') {
      const err = new Error(
        `缺少必填项：${(data.missing ?? []).join(', ')}`,
      ) as Error & { code?: string }
      err.code = 'missing_required_inputs'
      throw err
    }
    throw new Error(data.error || `runWorkflow: ${res.status}`)
  }
  if (!data.runId) throw new Error('runWorkflow: missing runId')
  return data.runId
}

export async function resumeWorkflow(
  runId: string,
  nodeId: string,
  decision: 'approve' | 'reject',
): Promise<void> {
  const res = await fetch(`${BLINO_SERVER}/workflow/resume/${encodeURIComponent(runId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, nodeId }),
  })
  if (!res.ok) throw new Error(`resumeWorkflow: ${res.status}`)
}

/**
 * EventSource + 断线重连（最多 3 次，间隔 2s）
 */
export function subscribeWorkflowEvents(
  runId: string,
  onEvent: (event: WorkflowEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  const url = `${BLINO_SERVER}/workflow/events/${encodeURIComponent(runId)}`
  let closed = false
  let attempts = 0
  const maxAttempts = 3
  let es: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const tryRecoverFromSnapshot = async (): Promise<boolean> => {
    try {
      const res = await fetch(
        `${BLINO_SERVER}/workflow/snapshot/${encodeURIComponent(runId)}`,
        { method: 'GET' },
      )
      if (!res.ok) return false
      const data = (await res.json()) as { nodes?: Record<string, { status?: string }> }
      const nodes = data?.nodes
      if (!nodes || Object.keys(nodes).length === 0) return false
      let anyRunning = false
      let anyFailed = false
      for (const n of Object.values(nodes)) {
        const st = n?.status
        if (st === 'pending' || st === 'running') {
          anyRunning = true
          break
        }
        if (st === 'failed') anyFailed = true
      }
      if (anyRunning) return false
      onEvent({
        type: 'workflow_complete',
        runId,
        status: anyFailed ? 'failed' : 'done',
      } as WorkflowEvent)
      return true
    } catch {
      return false
    }
  }

  const connect = () => {
    if (closed) return
    try {
      es = new EventSource(url)
    } catch (e) {
      onError?.(e instanceof Error ? e : new Error(String(e)))
      return
    }
    es.onmessage = (ev: MessageEvent) => {
      try {
        const p = JSON.parse(ev.data) as WorkflowEvent
        onEvent(p)
      } catch {
        /* ignore */
      }
    }
    es.onerror = () => {
      es?.close()
      es = null
      if (closed) return
      attempts += 1
      if (attempts > maxAttempts) {
        void (async () => {
          const recovered = await tryRecoverFromSnapshot()
          if (!recovered) {
            onError?.(new Error('SSE: max reconnect attempts'))
          }
        })()
        return
      }
      reconnectTimer = setTimeout(connect, 2000)
    }
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    es?.close()
  }
}
