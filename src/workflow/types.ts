/**
 * 工作流 DAG：定义与节点级快照
 */

export interface WorkflowInput {
  id: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'date'
  placeholder?: string
  options?: string[]
  default?: string
  required: boolean
}

export interface NodeDef {
  id: string
  prompt: string
  /** 省略=子 Agent 可用全部子工具；`[]`=仅文本、无工具；有元素=按名白名单 */
  allowedTools?: string[]
  /** 前驱节点 id；均须为 done 后本节点才执行 */
  dependsOn: string[]
  /** 为 true 时 V1 在 TTY 上暂停等待一次 Enter 再继续 */
  hilRequired: boolean
}

export interface WorkflowDef {
  id: string
  name: string
  description?: string
  inputs?: WorkflowInput[]
  nodes: NodeDef[]
}

export type WorkflowNodeStatus = 'pending' | 'running' | 'done' | 'failed'

/** 落盘节点：区分成功有文、成功无文、失败（含跳过的节点） */
export type WorkflowNodeSnapshot =
  | { status: 'pending' }
  | { status: 'running'; startedAt: string; finishedAt?: string }
  | { status: 'done'; result: string; emptyOutput?: true; startedAt?: string; finishedAt?: string }
  | { status: 'failed'; error: string; result: null; startedAt?: string; finishedAt?: string }

/**
 * 子 Agent（AgentTool）运行快照：供 UI 重试与断点排查
 * 主进程通过 sessionState.workflowSubAgentSnapshots[agentId] 与落盘文件同步
 */
export interface AgentSnapshot {
  agentId: string
  /** 与 workflow 节点关联时由 DAGEngine 注入 ToolContext.workflowNodeId */
  workflowNodeId?: string
  status: 'done' | 'failed'
  /** 成功时模型/工具产出的可展示文本 */
  resultText: string
  emptyOutput?: true
  /** 失败时完整错误信息 */
  error?: string
  /** 最后若干条消息摘要，便于重试时恢复语境 */
  messageSummary: Array<{ role: string; preview: string }>
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }
  updatedAt: string
}

/** 落盘到 ~/.blino/projects/<hash>/snapshot.json 的结构 */
export interface WorkflowSnapshotFile {
  version: 1
  updatedAt: string
  workflowId: string
  runSessionId: string
  projectRoot: string
  nodes: Record<string, WorkflowNodeSnapshot>
  /** AgentTool 子 agent 键为内部 agentId（8 位） */
  subAgentSnapshots?: Record<string, AgentSnapshot>
}
