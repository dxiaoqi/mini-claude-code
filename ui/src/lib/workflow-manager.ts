import type { DagCardState, WorkflowEvent, WorkflowSummary, WorkflowTask } from './types'
import { getWorkflowDetail, resumeWorkflow, runWorkflow, subscribeWorkflowEvents } from './workflow-client'
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
  decide: (runId: string, nodeId: string, decision: 'approve' | 'reject') => Promise<void>
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
    }
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

  async decide(runId: string, nodeId: string, decision: 'approve' | 'reject'): Promise<void> {
    await resumeWorkflow(runId, nodeId, decision)
  }
}

export const workflowManager: WorkflowManager = new WorkflowManagerService()
