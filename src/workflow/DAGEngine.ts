/**
 * 工作流 DAG 引擎：拓扑顺序、单线程执行、子 Agent 节点、快照持久化
 */
import readline from 'node:readline'
import { createAgentTool } from '../tools/agent/AgentTool.js'
import { dateContextProvider } from '../context/providers/dateContext.js'
import type {
  APIClient,
  AssistantMessage,
  ContextProvider,
  SessionState,
  Tool,
  ToolContext,
} from '../types.js'
import { logSubagentDebug } from '../utils/subagentDebug.js'
import type { AgentToolSuccessOutput } from '../tools/agent/AgentTool.js'
import { eventBus } from '../events/EventBus.js'
import { readWorkflowSnapshotFile, writeWorkflowSnapshotFile, buildSnapshotPayload } from './snapshotFile.js'
import { topologicalOrder } from './topo.js'
import type { NodeDef, WorkflowDef, WorkflowNodeSnapshot, WorkflowSnapshotFile } from './types.js'

export function interpolatePrompt(prompt: string, inputs: Record<string, string>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => inputs[key] ?? `{{${key}}}`)
}

function waitHilContinue(onLog: (s: string) => void): Promise<void> {
  if (!process.stdin.isTTY) {
    onLog('[workflow] (non-TTY) skipping HIL wait')
    return Promise.resolve()
  }
  onLog('[workflow] 等待审批 — 在终端按 Enter 继续本节点 (HIL)')
  onLog('[workflow] HIL: press Enter to run this node…')
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question('', () => {
      rl.close()
      resolve()
    })
  })
}

async function waitHilHttp(
  runId: string,
  node: NodeDef,
  nodeIndex: number,
  totalNodes: number,
  onLog: (s: string) => void,
): Promise<void> {
  const question = `是否继续执行 ${node.id} 节点？`
  const options = [
    { id: 'approve', label: '批准' },
    { id: 'reject', label: '拒绝' },
  ]
  onLog(`[workflow] HIL: waiting for UI approval (node ${node.id})…`)
  eventBus.emit('workflow_event', {
    id: runId,
    type: 'hil_suspend',
    runId,
    nodeId: node.id,
    nodeIndex,
    totalNodes,
    question,
    options,
  })
  const matchId = `${runId}#${node.id}`
  const p = (await eventBus.waitFor('workflow_hil_resume', matchId)) as {
    id: string
    decision?: string
  }
  if (p.decision === 'reject') {
    throw new Error('HIL: user rejected')
  }
}

/**
 * 将前驱节点已写入 `snap[depId].result` 的文本拼到当前 prompt 前，使子 Agent 用户消息中可见
 *（不依赖对端是否读 `workflowSnapshot`，仅靠本轮 prompt 传递）。
 */
function composeNodePrompt(
  node: NodeDef,
  snap: Record<string, WorkflowNodeSnapshot>,
  inputValues: Record<string, string>,
): string {
  const parts: string[] = []
  for (const depId of node.dependsOn) {
    const s = snap[depId]
    if (s?.status === 'done') {
      parts.push(`### ${depId}\n${s.result}`)
    }
  }
  const pre =
    parts.length > 0
      ? '## Previous step outputs\n\n' + parts.join('\n\n') + '\n\n## Current step task\n\n'
      : ''
  const noTools =
    node.allowedTools !== undefined && node.allowedTools.length === 0
  const boundary = noTools
    ? '你的任务只是生成文本内容，不要调用任何工具或命令。\n\n'
    : ''
  return pre + boundary + interpolatePrompt(node.prompt, inputValues)
}

/** 将仍处 pending 的节点标为 failed，避免落盘时看起来像“未跑过”的静默成功 */
/** 从落盘恢复：done 原样；failed / running 视为未完成，需重跑；pending 继续 */
function buildSnapFromFileOrDefault(
  loaded: WorkflowSnapshotFile | null,
  def: WorkflowDef,
  workflowIdMatches: boolean,
): Record<string, WorkflowNodeSnapshot> {
  const out: Record<string, WorkflowNodeSnapshot> = {}
  for (const n of def.nodes) {
    if (!workflowIdMatches || !loaded) {
      out[n.id] = { status: 'pending' }
      continue
    }
    const L = loaded.nodes[n.id]
    if (!L) {
      out[n.id] = { status: 'pending' }
      continue
    }
    if (L.status === 'done') {
      out[n.id] = L
    } else if (L.status === 'failed' || L.status === 'running') {
      out[n.id] = { status: 'pending' }
    } else {
      out[n.id] = L
    }
  }
  return out
}

function markPendingNodesAfterAbort(
  snap: Record<string, WorkflowNodeSnapshot>,
  allNodes: NodeDef[],
  sourceNodeId: string,
  detail: 'direct_failure' | 'blocked_dependency' | 'invalid_state',
) {
  const err =
    detail === 'blocked_dependency'
      ? `Skipped: dependency "${sourceNodeId}" did not complete successfully`
      : detail === 'invalid_state'
        ? `Skipped: dependency "${sourceNodeId}" was not in done state when required`
        : `Skipped: workflow stopped after node "${sourceNodeId}" failed`
  const t = new Date().toISOString()
  for (const n of allNodes) {
    if (snap[n.id]?.status === 'pending') {
      snap[n.id] = { status: 'failed', result: null, error: err, finishedAt: t }
    }
  }
}

export interface DAGEngineParams {
  def: WorkflowDef
  state: SessionState
  apiClient: APIClient
  tools: Tool[]
  contextProviders: ContextProvider[]
  onLog: (s: string) => void
  /** 一次运行 id（与 snapshot 文件名、UI/SSE 关联）；缺省为 state.sessionId */
  runId?: string
  /** CLI: TTY HIL；http: EventBus，供 UI 审批 */
  hilMode?: 'cli' | 'http'
  /** 工作流 `inputs` 的填充值，用于 `{{var}}` 模板替换 */
  inputValues?: Record<string, string>
}

/**
 * 执行工作流；节点状态 pending → running → done|failed
 * 任一节失败则停止执行、将后续仍为 pending 的节点标为 failed（并持久化由谁导致）
 */
function emitWorkflowEvent(runId: string, rest: Record<string, unknown>) {
  eventBus.emit('workflow_event', { id: runId, runId, ...rest })
}

export async function runDagWorkflow(params: DAGEngineParams): Promise<{ ok: boolean; lastError?: string }> {
  const { def, state, apiClient, tools, contextProviders, onLog, hilMode = 'cli' } = params
  const runId = params.runId ?? state.sessionId
  const inputValues = params.inputValues ?? {}
  const projectRoot = state.projectRoot

  const onDisk = await readWorkflowSnapshotFile(projectRoot, runId)
  const workflowIdMatches = !!(onDisk && onDisk.workflowId === def.id)
  const snap = buildSnapFromFileOrDefault(onDisk, def, workflowIdMatches)
  state.workflowSnapshot = snap
  if (workflowIdMatches && onDisk?.subAgentSnapshots) {
    state.workflowSubAgentSnapshots = { ...onDisk.subAgentSnapshots }
  } else {
    state.workflowSubAgentSnapshots = undefined
  }

  if (onDisk && workflowIdMatches) {
    onLog(`[workflow] 已从快照恢复 (workflowId=${def.id}；done 的节点将跳过）`)
  }

  const persist = async () => {
    await writeWorkflowSnapshotFile(
      projectRoot,
      buildSnapshotPayload(
        def.id,
        runId,
        projectRoot,
        { ...snap },
        state.workflowSubAgentSnapshots,
      ),
    )
  }

  await persist()

  const order = topologicalOrder(def.nodes)
  const totalNodes = order.length
  const subToolList = tools.filter(t => t.name !== 'Agent')
  const canUseTool = async () => ({ behavior: 'allow' as const })
  const agentTool = createAgentTool(apiClient, subToolList, [...contextProviders, dateContextProvider], canUseTool)
  const parentMessage: AssistantMessage = { role: 'assistant', content: [] }
  const abort = new AbortController()
  const toolContextBase: Omit<ToolContext, 'workflowNodeId'> = {
    sessionState: state,
    cwd: state.cwd,
    abortController: abort,
    options: { tools: subToolList, mainModel: state.model },
  }

  for (const node of order) {
    const nodeIndex = order.findIndex(n => n.id === node.id)
    if (snap[node.id].status === 'done') {
      onLog(`[workflow] node ${node.id}: skipped (snapshot found)`)
      const prev = snap[node.id]
      const r = prev.status === 'done' ? prev.result : ''
      emitWorkflowEvent(runId, { type: 'node_start', nodeId: node.id, nodeIndex, totalNodes })
      emitWorkflowEvent(runId, { type: 'node_done', nodeId: node.id, result: r })
      continue
    }

    for (const d of node.dependsOn) {
      const st = snap[d]?.status
      if (st === 'failed') {
        const msg = `Blocked: dependency "${d}" failed`
        snap[node.id] = {
          status: 'failed',
          result: null,
          error: msg,
          finishedAt: new Date().toISOString(),
        }
        onLog(`[workflow] node ${node.id} ${msg}`)
        markPendingNodesAfterAbort(snap, def.nodes, d, 'blocked_dependency')
        emitWorkflowEvent(runId, { type: 'workflow_error', runId, nodeId: node.id, error: msg })
        emitWorkflowEvent(runId, { type: 'workflow_complete', runId, status: 'failed' })
        await persist()
        return { ok: false, lastError: msg }
      }
      if (st !== 'done') {
        const msg = `Invalid state: "${d}" is ${st}, expected done`
        snap[node.id] = {
          status: 'failed',
          result: null,
          error: msg,
          finishedAt: new Date().toISOString(),
        }
        onLog(`[workflow] node ${node.id} ${msg}`)
        markPendingNodesAfterAbort(snap, def.nodes, d, 'invalid_state')
        emitWorkflowEvent(runId, { type: 'workflow_error', runId, nodeId: node.id, error: msg })
        emitWorkflowEvent(runId, { type: 'workflow_complete', runId, status: 'failed' })
        await persist()
        return { ok: false, lastError: msg }
      }
    }

    if (node.hilRequired) {
      try {
        if (hilMode === 'http') {
          await waitHilHttp(runId, node, nodeIndex, totalNodes, onLog)
        } else {
          await waitHilContinue(onLog)
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        snap[node.id] = {
          status: 'failed',
          result: null,
          error: errMsg,
          finishedAt: new Date().toISOString(),
        }
        onLog(`[workflow] node ${node.id} HIL: ${errMsg}`)
        markPendingNodesAfterAbort(snap, def.nodes, node.id, 'direct_failure')
        emitWorkflowEvent(runId, { type: 'workflow_error', nodeId: node.id, error: errMsg })
        emitWorkflowEvent(runId, { type: 'workflow_complete', status: 'failed' })
        await persist()
        return { ok: false, lastError: errMsg }
      }
    }

    emitWorkflowEvent(runId, { type: 'node_start', nodeId: node.id, nodeIndex, totalNodes })

    onLog(`[workflow] node ${node.id} running…`)
    snap[node.id] = {
      status: 'running',
      startedAt: new Date().toISOString(),
    }
    await persist()

    const finalPrompt = composeNodePrompt(node, snap, inputValues)
    const input = {
      prompt: finalPrompt,
      allowed_tools: node.allowedTools,
    }

    const toolMode =
      input.allowed_tools === undefined
        ? 'all'
        : input.allowed_tools.length === 0
          ? 'none'
          : 'whitelist'
    logSubagentDebug(`workflow:${node.id}`, 'invoke agentTool', {
      promptChars: finalPrompt.length,
      toolMode,
      allowedNames: input.allowed_tools,
      subTools: subToolList.length,
    })

    const toolContext: ToolContext = { ...toolContextBase, workflowNodeId: node.id }

    try {
      const out = await agentTool.call(
        input,
        toolContext,
        canUseTool,
        parentMessage,
        undefined,
      )
      const data = out.data as AgentToolSuccessOutput
      const cur = snap[node.id]
      const startedAt = cur.status === 'running' ? cur.startedAt : undefined
      const noText = !!(data.emptyOutput || (data.result ?? '').trim() === '')
      if (noText && data.stopReason === 'content_filter') {
        const errMsg = 'content_filter: model refused output'
        snap[node.id] = {
          status: 'failed',
          result: null,
          error: errMsg,
          startedAt,
          finishedAt: new Date().toISOString(),
        }
        onLog(`[workflow] node ${node.id} failed: ${errMsg}`)
        markPendingNodesAfterAbort(snap, def.nodes, node.id, 'direct_failure')
        emitWorkflowEvent(runId, { type: 'workflow_error', nodeId: node.id, error: errMsg })
        emitWorkflowEvent(runId, { type: 'workflow_complete', status: 'failed' })
        await persist()
        return { ok: false, lastError: errMsg }
      }
      if (data.emptyOutput) {
        snap[node.id] = {
          status: 'done',
          result: '',
          emptyOutput: true,
          startedAt,
          finishedAt: new Date().toISOString(),
        }
      } else {
        snap[node.id] = {
          status: 'done',
          result: data.result,
          startedAt,
          finishedAt: new Date().toISOString(),
        }
      }
      emitWorkflowEvent(runId, { type: 'node_done', nodeId: node.id, result: data.emptyOutput ? '' : data.result })
      onLog(`[workflow] node ${node.id} done`)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      const curFail = snap[node.id]
      const failStarted = curFail.status === 'running' ? curFail.startedAt : undefined
      snap[node.id] = {
        status: 'failed',
        result: null,
        error: errMsg,
        startedAt: failStarted,
        finishedAt: new Date().toISOString(),
      }
      onLog(`[workflow] node ${node.id} failed: ${errMsg}`)
      markPendingNodesAfterAbort(snap, def.nodes, node.id, 'direct_failure')
      emitWorkflowEvent(runId, { type: 'workflow_error', nodeId: node.id, error: errMsg })
      emitWorkflowEvent(runId, { type: 'workflow_complete', status: 'failed' })
      await persist()
      return { ok: false, lastError: errMsg }
    }
    await persist()
  }

  emitWorkflowEvent(runId, { type: 'workflow_complete', status: 'done' })
  return { ok: true }
}
