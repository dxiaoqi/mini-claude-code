// ─── Visual block types ──────────────────────────────────────────────────────

export type VisualBlockType = 'svg' | 'html' | 'threejs'

export interface TextContentBlock {
  kind: 'text'
  id: string
  content: string
  isStreaming: boolean
}

export interface VisualContentBlock {
  kind: 'visual'
  id: string
  visualType: VisualBlockType
  content: string
  isComplete: boolean
}

export type ContentBlock = TextContentBlock | VisualContentBlock

// ─── Protocol types ───────────────────────────────────────────────────────────

export type WidgetType = 'markdown' | 'svg' | 'html' | 'chart' | string

export interface WidgetProps {
  id: string
  type: WidgetType
  title?: string
  [key: string]: string | undefined
}

export type CriterionType =
  | 'widget_exists'
  | 'widget_count'
  | 'word_count'
  | 'covers_topics'
  | 'has_title'
  | 'semantic'

export interface Criterion {
  type: CriterionType
  params: Record<string, string | number>
  weight?: number
}

// ─── Plan / Phase ─────────────────────────────────────────────────────────────

export type PhaseStatus = 'pending' | 'running' | 'review' | 'done' | 'abandoned' | 'skipped'

export interface PhaseBudget {
  maxOutputTokens: number
  maxAttempts: number
  timeoutMs: number
}

export interface WidgetSnapshot {
  id: string
  type: WidgetType
  title?: string
  preview: string
  charCount: number
}

export interface PhaseOutcome {
  phaseId: string
  goal: string
  status: 'done' | 'abandoned'
  widgetsProduced: WidgetSnapshot[]
  keyPoints: string[]
  topicsCovered: string[]
}

export interface Phase {
  id: string
  goal: string
  acceptance: Criterion[]
  expectedWidgetTypes: string[]
  dependsOn: string[]
  budget: PhaseBudget
  status: PhaseStatus
  attempts: number
  output: {
    widgets: WidgetSnapshot[]
    tokensUsed: number
    durationMs: number
  }
  outcome?: PhaseOutcome
}

export type Modality = 'visual-heavy' | 'text-heavy' | 'interactive' | 'mixed'
export type Depth = 'skim' | 'standard' | 'deep-dive'
export type Interactivity = 'static' | 'explorable' | 'conversational'
export type Audience = 'novice' | 'practitioner' | 'expert'
export type Certainty = 'clear' | 'ambiguous' | 'exploratory'

export interface Dimensions {
  modality: Modality
  depth: Depth
  interactivity: Interactivity
  audience: Audience
  certainty: Certainty
}

export interface PlanBudget {
  maxTotalOutputTokens: number
  maxPhaseCount: number
  maxReplanCount: number
  maxHilCount: number
}

export interface Plan {
  id: string
  recipeId: string | null
  dimensions: Dimensions
  phases: Phase[]
  budget: PlanBudget
  state: {
    currentPhaseId: string | null
    completedPhaseIds: string[]
    abandonedPhaseIds: string[]
    replanCount: number
  }
}

// ─── Artifact / Turn / Session ────────────────────────────────────────────────

export type ArtifactStatus = 'generating' | 'ready' | 'editing' | 'archived'
export type TurnStatus = 'pending' | 'running' | 'completed' | 'interrupted' | 'errored' | 'timeout'
export type TurnRole = 'user' | 'assistant'

export interface StoredWidget {
  id: string
  artifactId: string
  sequence: number
  type: WidgetType
  title?: string
  content: string
  status: 'complete' | 'partial' | 'failed'
  metadata: Record<string, unknown>
}

export interface Artifact {
  id: string
  turnId: string
  status: ArtifactStatus
  planSnapshot?: Plan
  widgets: StoredWidget[]
  createdAt: number
  updatedAt: number
  parentArtifactId?: string
}

export interface Turn {
  id: string
  conversationId: string
  sequence: number
  role: TurnRole
  userInput: string
  status: TurnStatus
  artifactId?: string
  errorInfo?: string
  createdAt: number
  completedAt?: number
}

export interface Conversation {
  id: string
  sessionId: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface SessionPreferences {
  theme: 'dark' | 'light'
  defaultDepth: Depth
  animationEnabled: boolean
  hilTolerance: 'low' | 'normal' | 'high'
}

// ─── Workflow (P4) ───────────────────────────────────────────────────────────

export interface WorkflowInput {
  id: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'date'
  placeholder?: string
  options?: string[]
  default?: string
  required: boolean
}

export interface WorkflowSummary {
  id: string
  name: string
  description: string
  nodeCount: number
  nodeIds: string[]
  inputs?: WorkflowInput[]
  /** 节点与依赖，用于 DAG 卡布局 */
  nodes: Array<{ id: string; dependsOn: string[] }>
}

export type WorkflowNodeStateStatus = 'pending' | 'running' | 'done' | 'failed' | 'waiting'

export interface NodeState {
  status: WorkflowNodeStateStatus
  result?: string
  error?: string
}

/** @deprecated 使用 NodeState */
export type WorkflowDagNodeState = NodeState

export interface HILState {
  nodeId: string
  question: string
  options: Array<{ id: string; label: string }>
  decided: boolean
  decision?: 'approve' | 'reject'
  decidedAt?: string
}

/** @deprecated 使用 HILState */
export type WorkflowDagHilState = HILState

export interface DagCardState {
  workflowId: string
  workflowName: string
  runId: string
  nodeIds: string[]
  nodeStates: Record<string, NodeState>
  hilState?: HILState
  overallStatus: 'running' | 'done' | 'failed'
  inputValues: Record<string, string>
  globalError?: string
}

/** 后台工作流任务（由 workflow-manager 维护，多任务并发） */
export interface WorkflowTask {
  runId: string
  /** 启动时绑定的 Blino session（供同步 ui-message、恢复 UI） */
  sessionId: string
  workflowId: string
  workflowName: string
  /** 与 chat 中占位/结论消息对应 */
  messageId: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  /** 复刻 WorkflowDAGCard 所需元数据 */
  workflow: WorkflowSummary
  nodeIds: string[]
  dagState: DagCardState | null
  /** 拓扑最后一个有文本结果的节点 */
  finalResult?: string
  finalNodeId?: string
  lastError?: string
}

export type ToastType = 'hil' | 'done' | 'error'

export interface WorkflowToast {
  id: string
  type: ToastType
  runId: string
  workflowName: string
  nodeId?: string
  question?: string
  options?: Array<{ id: string; label: string }>
  decided?: boolean
  decision?: 'approve' | 'reject'
  finalResult?: string
  errorMessage?: string
  autoCloseMs?: number
}

export type SlashCommandCategory = 'workflow' | 'skill' | 'session' | 'settings'

export interface SlashCommandItem {
  id: string
  category: SlashCommandCategory
  name: string
  description: string
  badge?: string
  hasChildren?: boolean
  data?: unknown
}

export type WorkflowEventType =
  | 'node_start'
  | 'node_done'
  | 'workflow_complete'
  | 'workflow_error'
  | 'hil_suspend'

export interface WorkflowEvent {
  type: WorkflowEventType
  runId: string
  nodeId?: string
  nodeIndex?: number
  totalNodes?: number
  result?: string
  error?: string
  question?: string
  options?: Array<{ id: string; label: string }>
  status?: 'done' | 'failed'
  id?: string
}

export type WorkflowBubbleType =
  | 'workflow_started'
  | 'workflow_progress'
  | 'workflow_hil'
  | 'workflow_complete'
  | 'workflow_error'

export interface WorkflowBubble {
  id: string
  bubbleType: WorkflowBubbleType
  runId?: string
  workflowId?: string
  workflowName?: string
  nodeIds?: string[]
  nodeId?: string
  nodeIndex?: number
  totalNodes?: number
  result?: string
  error?: string
  question?: string
  options?: Array<{ id: string; label: string }>
  hilDecision?: 'approve' | 'reject'
  hilDecidedAt?: number
  status?: 'running' | 'done' | 'failed'
  createdAt: number
}

export interface Session {
  id: string
  userId?: string
  createdAt: number
  updatedAt: number
  preferences: SessionPreferences
}

// ─── Unified UI Events (Server → Client, wire format) ─────────────────────────
// Naming: namespace.verb, dot-separated, present tense.
// Mirrors /blino UIEvent type.

export type UIEventType =
  // ── Agent mode ──
  | 'text.delta'
  | 'think.start'
  | 'think.delta'
  | 'think.end'
  | 'tool.start'
  | 'tool.delta'
  | 'tool.result'
  | 'message.start'
  | 'message.end'
  | 'turn.complete'
  | 'session.complete'
  | 'session.end'
  | 'done'
  | 'agent.spawn'
  | 'agent.complete'
  | 'permission.request'
  | 'error.occurred'
  | 'status'
  // ── Visual mode ──
  | 'conversational.reply'
  | 'plan.create'
  | 'plan.complete'
  | 'phase.start'
  | 'phase.complete'
  | 'phase.abandon'
  | 'phase.transition'
  | 'critic.thinking'
  | 'milestone'
  | 'hil.requested'
  | 'widget.open'
  | 'widget.delta'
  | 'widget.close'
  | 'block.text_start'
  | 'block.text_delta'
  | 'block.text_end'
  | 'block.visual_start'
  | 'block.visual'

/** Flat UI event — type + fields at root level, no nested payload wrapper. */
export type UIEvent = {
  type: UIEventType | (string & {})
  [key: string]: unknown
}

/** @deprecated Use UIEvent */
export type DisplayEventType = UIEventType
/** @deprecated Use UIEvent */
export type DisplayEvent = UIEvent

// ─── Stream Parser Events (Internal) ─────────────────────────────────────────

export type ParserEventType =
  | 'plan_started'
  | 'plan_finished'
  | 'phase_started'
  | 'phase_finished'
  | 'widget_opened'
  | 'widget_chunk'
  | 'widget_closed'
  | 'think_started'
  | 'think_chunk'
  | 'think_finished'
  | 'milestone'
  | 'warning'
  | 'edit_started'
  | 'edit_finished'
  | 'modify_started'
  | 'modify_finished'
  | 'append_after'
  | 'remove'

export interface ParserEvent {
  type: ParserEventType
  payload: Record<string, unknown>
}

// ─── Critic ───────────────────────────────────────────────────────────────────

export interface CriticResult {
  passed: boolean
  reason: string
  checkType: 'structural' | 'semantic' | 'quality'
  failedCriteria?: string[]
}

// ─── Error ────────────────────────────────────────────────────────────────────

export type ErrorCategory = 'protocol' | 'validation' | 'semantic' | 'resource' | 'tool' | 'system' | 'user'

export interface AppError {
  category: ErrorCategory
  code: string
  message: string
  userMessage?: string
  context?: {
    turnId?: string
    artifactId?: string
    phaseId?: string
    widgetId?: string
  }
  retryable: boolean
  retryCount?: number
}

// ─── Recipe ───────────────────────────────────────────────────────────────────

export interface RecipeMeta {
  id: string
  when: {
    dimensions?: Partial<Dimensions>
    keywords?: string[]
  }
  minPhases: number
  maxPhases: number
  maxTotalTokens: number
  skillFilesToLoad: string[]
  widgetPalette: WidgetType[]
}
