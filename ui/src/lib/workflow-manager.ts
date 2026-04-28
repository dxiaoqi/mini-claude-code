import type { DagCardState, WorkflowEvent, WorkflowSummary, WorkflowTask } from './types'
import { getWorkflowDetail, listRunningWorkflows, resumeWorkflow, runWorkflow, subscribeWorkflowEvents } from './workflow-client'
import { topologicalNodeIds } from './workflow-topo'

function extractFinalResult(
  dag: DagCardState,
  graphNodes: Array<{ id: string; dependsOn: string[] }>,
): { text?: string; nodeId?: string } {
  const order = dag.nodeIds?.length
    ? dag.nodeIds
    : graphNodes.length
      ? topologicalNodeIds(graphNodes)
      : []
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!
    const st = dag.nodeStates[id]
    if (st?.status === 'done' && st.result != null && String(st.result).trim() !== '') {
      return { text: st.result, nodeId: id }
    }
  }
  return {}
}

async function resolveNodeOrder(
  workflow: WorkflowSummary,
): Promise<{ orderIds: string[]; graphNodes: Array<{ id: string; dependsOn: string[] }> }> {
  let graphNodes: Array<{ id: string; dependsOn: string[] }> =
    workflow.nodes?.length > 0
      ? workflow.nodes
      : (workflow.nodeIds ?? []).map(id => ({ id, dependsOn: [] as string[] }))
  let orderIds: string[] = workflow.nodeIds?.length
    ? workflow.nodeIds
    : graphNodes.length
      ? topologicalNodeIds(graphNodes)
      : []
  if (orderIds.length === 0) {
    const full = await getWorkflowDetail(workflow.id)
    if (full) {
      graphNodes =
        full.nodes?.length > 0
          ? full.nodes
          : (full.nodeIds ?? []).map(id => ({ id, dependsOn: [] as string[] }))
      orderIds = full.nodeIds?.length
        ? full.nodeIds
        : graphNodes.length
          ? topologicalNodeIds(graphNodes)
          : []
    }
  }
  return { orderIds, graphNodes }
}

export interface WorkflowManager {
  start: (p: {
    workflow: WorkflowSummary
    sessionId: string
    inputValues: Record<string, string>
    messageId: string
  }) => Promise<string>
  getTasks: () => WorkflowTask[]
  subscribe: (handler: (tasks: WorkflowTask[]) => void) => () => void
  decide: (runId: string, nodeId: string, decision: 'approve' | 'reject', waiterId?: string) => Promise<void>
  /**
   * Reattach to running workflows after page refresh.
   * Fetches /workflow/list-running, rebuilds task state from snapshots,
   * and re-subscribes to SSE for each active run.
   * @param chatMessages - current chat messages to find matching messageId by workflowRunId
   */
  reattach: (chatMessages: Array<{ id: string; workflowRunId?: string; workflowPlaceholder?: boolean; workflowHost?: boolean }>) => Promise<Array<{ messageId: string; runId: string; workflowName: string }>>
  /** 新对话等场景清空任务与 SSE */
  reset: () => void
}

class WorkflowManagerService implements WorkflowManager {
  private tasks = new Map<string, WorkflowTask>()
  private unsubs = new Map<string, () => void>()
  private listeners = new Set<(tasks: WorkflowTask[]) => void>()

  getTasks(): WorkflowTask[] {
    return Array.from(this.tasks.values())
  }

  private emit() {
    const arr = this.getTasks()
    this.listeners.forEach(l => {
      l(arr)
    })
  }

  subscribe(handler: (tasks: WorkflowTask[]) => void): () => void {
    this.listeners.add(handler)
    handler(this.getTasks())
    return () => {
      this.listeners.delete(handler)
    }
  }

  reset(): void {
    for (const u of Array.from(this.unsubs.values())) {
      try {
        u()
      } catch {
        /* */
      }
    }
    this.unsubs.clear()
    this.tasks.clear()
    this.emit()
  }

  private updateTask(runId: string, patch: (t: WorkflowTask) => WorkflowTask) {
    const cur = this.tasks.get(runId)
    if (!cur) return
    this.tasks.set(runId, patch(cur))
    this.emit()
  }

  private onServerEvent(t: WorkflowTask, ev: WorkflowEvent) {
    const type = (ev as { type?: string }).type
    const runId = t.runId
    if (type === 'node_start' && ev.nodeId) {
      this.updateTask(runId, cur => {
        if (!cur.dagState) return cur
        const h = cur.dagState.hilState
        const nextHil = h?.nodeId === ev.nodeId ? undefined : h
        return {
          ...cur,
          dagState: {
            ...cur.dagState,
            hilState: nextHil,
            nodeStates: {
              ...cur.dagState.nodeStates,
              [ev.nodeId!]: { status: 'running' },
            },
          },
        }
      })
      return
    }
    if (type === 'node_done' && ev.nodeId) {
      this.updateTask(runId, cur => {
        if (!cur.dagState) return cur
        return {
          ...cur,
          dagState: {
            ...cur.dagState,
            nodeStates: {
              ...cur.dagState.nodeStates,
              [ev.nodeId!]: { status: 'done', result: ev.result },
            },
          },
        }
      })
      return
    }
    if (type === 'hil_suspend' && ev.nodeId && runId) {
      this.updateTask(runId, cur => {
        if (!cur.dagState) return cur
        return {
          ...cur,
          dagState: {
            ...cur.dagState,
            nodeStates: {
              ...cur.dagState.nodeStates,
              [ev.nodeId!]: { status: 'waiting' },
            },
            hilState: {
              nodeId: ev.nodeId!,
              question: ev.question ?? '是否继续？',
              options: ev.options ?? [
                { id: 'approve', label: '批准' },
                { id: 'reject', label: '拒绝' },
              ],
              decided: false,
              waiterId: ev.waiterId,
            },
          },
        }
      })
      return
    }
    if (type === 'workflow_error') {
      this.updateTask(runId, cur => {
        if (!cur.dagState) {
          return {
            ...cur,
            status: 'failed',
            lastError: ev.error || 'Error',
            dagState: null,
          }
        }
        const nextNodes = { ...cur.dagState.nodeStates }
        if (ev.nodeId) {
          nextNodes[ev.nodeId] = { status: 'failed', error: ev.error || 'Error' }
        }
        return {
          ...cur,
          status: 'failed',
          lastError: ev.error || cur.dagState.globalError,
          dagState: {
            ...cur.dagState,
            nodeStates: nextNodes,
            overallStatus: 'failed',
            hilState: undefined,
            globalError: !ev.nodeId && ev.error ? ev.error : cur.dagState.globalError,
          },
        }
      })
      return
    }
    if (type === 'workflow_complete') {
      const before = this.tasks.get(runId)
      if (before && (before.status === 'done' || before.status === 'failed')) {
        return
      }
      const u = this.unsubs.get(runId)
      u?.()
      this.unsubs.delete(runId)
      this.updateTask(runId, cur => {
        if (!cur.dagState) {
          return {
            ...cur,
            status: ev.status === 'failed' ? 'failed' : 'done',
          }
        }
        const d: DagCardState = {
          ...cur.dagState,
          overallStatus: ev.status === 'failed' ? 'failed' : 'done',
          hilState: undefined,
        }
        const { text, nodeId } =
          ev.status === 'done' ? extractFinalResult(d, cur.workflow.nodes) : {}
        return {
          ...cur,
          status: ev.status === 'failed' ? 'failed' : 'done',
          dagState: d,
          finalResult: text,
          finalNodeId: nodeId,
        }
      })
      const final = this.tasks.get(runId)
      if (typeof globalThis !== 'undefined' && 'dispatchEvent' in globalThis) {
        try {
          ;(globalThis as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(
            new CustomEvent('blino:workflow:terminal', {
              detail: {
                runId,
                status: final?.status,
                workflowName: final?.workflowName,
                sessionId: final?.sessionId,
                lastError: final?.lastError,
              },
            }),
          )
        } catch {
          /* */
        }
      }
    }
  }

  async reattach(
    chatMessages: Array<{ id: string; workflowRunId?: string; workflowPlaceholder?: boolean; workflowHost?: boolean }>,
  ): Promise<Array<{ messageId: string; runId: string; workflowName: string }>> {
    const running = await listRunningWorkflows()
    if (running.length === 0) return []

    const reattached: Array<{ messageId: string; runId: string; workflowName: string }> = []

    await Promise.all(
      running.map(async ({ runId, workflowId }) => {
        // Skip if already tracked (e.g. called twice)
        if (this.tasks.has(runId)) return

        // Fetch snapshot for node states
        let nodeStates: Record<string, { status: string; result?: string; error?: string }> = {}
        try {
          const snapRes = await fetch(
            `${process.env.NEXT_PUBLIC_BLINO_URL || 'http://localhost:3001'}/workflow/snapshot/${encodeURIComponent(runId)}`,
          )
          if (snapRes.ok) {
            const snap = (await snapRes.json()) as {
              nodes?: Record<string, { status?: string; result?: string | null; error?: string }>
            }
            if (snap.nodes) {
              for (const [id, n] of Object.entries(snap.nodes)) {
                nodeStates[id] = {
                  status: n.status ?? 'pending',
                  ...(n.result != null ? { result: String(n.result) } : {}),
                  ...(n.error ? { error: n.error } : {}),
                }
              }
            }
          }
        } catch { /* ignore — proceed with empty states */ }

        // Fetch workflow metadata
        const wf = await getWorkflowDetail(workflowId).catch(() => null)
        const workflowName = wf?.name ?? workflowId
        const orderIds = wf?.nodeIds ?? Object.keys(nodeStates)
        const graphNodes = wf?.nodes ?? orderIds.map(id => ({ id, dependsOn: [] as string[] }))

        // Find the matching chat message: prefer workflowRunId match, fall back to workflowHost
        const matchingMsg = chatMessages.find(m => m.workflowRunId === runId)
        const messageId = matchingMsg?.id ?? `reattached-${runId}`

        const dagNodeStates: Record<string, import('./types').NodeState> = {}
        for (const id of orderIds) {
          const s = nodeStates[id]
          dagNodeStates[id] = s
            ? { status: s.status as import('./types').WorkflowNodeStateStatus, result: s.result, error: s.error }
            : { status: 'pending' }
        }

        const task: WorkflowTask = {
          runId,
          sessionId: '',
          workflowId,
          workflowName,
          messageId,
          status: 'running',
          startedAt: Date.now(),
          workflow: { id: workflowId, name: workflowName, description: '', nodeCount: orderIds.length, nodeIds: orderIds, nodes: graphNodes },
          nodeIds: orderIds,
          dagState: {
            workflowId,
            workflowName,
            runId,
            nodeIds: orderIds,
            nodeStates: dagNodeStates,
            overallStatus: 'running',
            inputValues: {},
          },
        }

        this.tasks.set(runId, task)
        this.emit()

        const unsub = subscribeWorkflowEvents(
          runId,
          ev => {
            const t = this.tasks.get(runId)
            if (t) this.onServerEvent(t, ev)
          },
          () => { /* SSE errors */ },
        )
        this.unsubs.set(runId, unsub)
        reattached.push({ messageId, runId, workflowName })
      }),
    )

    return reattached
  }

  async start(params: {
    workflow: WorkflowSummary
    sessionId: string
    inputValues: Record<string, string>
    messageId: string
  }): Promise<string> {
    const { workflow, sessionId, inputValues, messageId } = params
    const { orderIds, graphNodes } = await resolveNodeOrder(workflow)
    if (orderIds.length === 0) {
      throw new Error('工作流无节点元数据')
    }
    const runId = await runWorkflow(workflow.id, sessionId, inputValues)
    const wfull: WorkflowSummary = {
      ...workflow,
      nodes: graphNodes,
      nodeIds: orderIds,
    }
    const task: WorkflowTask = {
      runId,
      sessionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      messageId,
      status: 'running',
      startedAt: Date.now(),
      workflow: wfull,
      nodeIds: orderIds,
      dagState: {
        workflowId: workflow.id,
        workflowName: workflow.name,
        runId,
        nodeIds: orderIds,
        nodeStates: Object.fromEntries(orderIds.map(id => [id, { status: 'pending' as const }])),
        overallStatus: 'running',
        inputValues,
      },
    }
    this.tasks.set(runId, task)
    this.emit()
    const r = runId
    const unsub = subscribeWorkflowEvents(
      r,
      ev => {
        const t = this.tasks.get(r)
        if (t) this.onServerEvent(t, ev)
      },
      () => {
        /* SSE errors — 保持任务，让 UI 走超时或 workflow_error */
      },
    )
    this.unsubs.set(r, unsub)
    return r
  }

  async decide(runId: string, nodeId: string, decision: 'approve' | 'reject', waiterId?: string): Promise<void> {
    await resumeWorkflow(runId, nodeId, decision, waiterId)
  }
}

export const workflowManager: WorkflowManager = new WorkflowManagerService()
