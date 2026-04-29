/**
 * types.ts — 核心类型定义
 *
 * 定义 Message、Tool、Permission、State、StreamEvent、ContextProvider、UIAdapter 等公共类型与接口。
 */
import type { z } from 'zod'
import type { AgentSnapshot, WorkflowNodeSnapshot } from './workflow/types.js'

// ────────────────────────────────────────────
//  Message Types
// ────────────────────────────────────────────

export type Role = 'user' | 'assistant' | 'system'

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | ContentBlock[]
  is_error?: boolean
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock

export interface UserMessage {
  role: 'user'
  content: string | ContentBlock[]
}

export interface AssistantMessage {
  role: 'assistant'
  content: string | ContentBlock[]
}

export interface SystemMessage {
  role: 'system'
  content: string
  type?: 'compact_boundary' | 'tombstone'
}

export type Message = UserMessage | AssistantMessage | SystemMessage

// ────────────────────────────────────────────
//  Tool Types
// ────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high'

export interface PermissionUpdate {
  type: 'addRules'
  rules: Array<{ toolName: string; pattern?: string }>
  behavior: 'allow' | 'deny'
  destination: 'session' | 'project' | 'user'
}

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'ask'; message: string; riskLevel?: RiskLevel; suggestions?: PermissionUpdate[] }
  | { behavior: 'deny'; reason: string }
  | { behavior: 'passthrough'; message: string; suggestions?: PermissionUpdate[] }

export interface ValidationResult {
  result: boolean
  message?: string
  errorCode?: number
}

export type ProgressCallback = (progress: { toolUseID: string; data: unknown }) => void

export interface ToolContext {
  sessionState: SessionState
  cwd: string
  abortController: AbortController
  agentId?: string
  options: {
    tools: Tool[]
    mainModel: string
  }
  onProgress?: ProgressCallback
  setHasInterruptibleToolInProgress?: (value: boolean) => void
  /** AskUserTool 使用的回调：向用户提问并等待回答 */
  askUser?: (question: string, options?: Array<{ id: string; label: string }>) => Promise<string>
  /** MCP 资源工具使用：提供对 MCPClientManager 的访问 */
  mcpManager?: { getAllConnections(): unknown[] }
  /** Logger instance for structured logging */
  logger?: unknown
  /** 由 DAGEngine 注入：当前 workflow 节点 id，子 Agent 快照可关联到节点 */
  workflowNodeId?: string
}

export type CanUseToolFn = (
  tool: Tool,
  input: Record<string, unknown>,
  assistantMessage: AssistantMessage,
) => Promise<PermissionResult>

export interface ToolResult<T = unknown> {
  data: T
  metadata?: Record<string, unknown>
}

export interface ToolResultBlockParam {
  tool_use_id: string
  type: 'tool_result'
  content: string | ContentBlock[]
  is_error?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Tool<Input = any, Output = any> {
  name: string
  aliases?: string[]
  description: string | ((input: Input, ctx: ToolContext) => Promise<string>)

  inputSchema: z.ZodType<Input>
  call(
    input: Input,
    context: ToolContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ProgressCallback,
  ): Promise<ToolResult<Output>>

  validateInput?(input: Input, context: ToolContext): ValidationResult | Promise<ValidationResult>

  checkPermissions(input: Input, context: ToolContext): Promise<PermissionResult>
  isReadOnly?(input: Input): boolean
  isDestructive?(input: Input): boolean
  isConcurrencySafe?(input: Input): boolean

  backfillObservableInput?(input: Record<string, unknown>): void

  interruptBehavior?(): 'cancel' | 'block'

  readonly shouldDefer?: boolean
  readonly alwaysLoad?: boolean

  isEnabled?(): boolean
  maxResultSizeChars?: number

  mapToolResultToToolResultBlockParam?(
    output: Output,
    toolUseID: string,
  ): ToolResultBlockParam
}

// ────────────────────────────────────────────
//  Permission Types
// ────────────────────────────────────────────

export type PermissionMode = 'default' | 'plan' | 'auto' | 'bypass'

export interface PermissionRule {
  tool: string
  pattern?: string
  pathPrefix?: string
  decision: 'allow' | 'deny'
  source: 'session' | 'project' | 'user' | 'cli'
}

// ────────────────────────────────────────────
//  API / Stream Types
// ────────────────────────────────────────────

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'tool_use_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_use_delta'; id: string; partialInput: string }
  | { type: 'tool_result'; toolName: string; toolUseId: string; result: unknown; isError?: boolean }
  | { type: 'message_start'; messageId: string; model: string }
  | { type: 'message_end'; usage: Usage; stopReason: string }
  | { type: 'error'; error: Error }
  | { type: 'agent_spawn'; agentId: string; prompt: string }
  | { type: 'agent_complete'; agentId: string; result: string; usage: Usage }
  | { type: 'turn_complete'; turnCount: number; usage: Usage }
  | { type: 'session_complete'; reason: string }
  | { type: 'compact'; tokensFreed: number; strategies: string[]; tokensBefore: number; tokensAfter: number }

// ────────────────────────────────────────────
//  Unified UI Events (SSE wire format)
//  Naming: namespace.verb, dot-separated, present tense.
//  Used by HttpServerAdapter when emitting SSE to frontend.
// ────────────────────────────────────────────

export type UIEvent =
  // ── Text / Think streaming ──
  | { type: 'text.delta'; text: string }
  | { type: 'think.start' }
  | { type: 'think.delta'; text: string }
  | { type: 'think.end' }
  // ── Tools ──
  | { type: 'tool.start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool.delta'; id: string; partialInput: string }
  | { type: 'tool.result'; toolName: string; toolUseId: string; result: unknown; isError?: boolean }
  // ── Message lifecycle ──
  | { type: 'message.start'; messageId: string; model: string }
  | { type: 'message.end'; usage: Usage; stopReason: string }
  | { type: 'turn.complete'; turnCount?: number; usage?: Usage; artifactId?: string }
  | { type: 'session.complete'; reason: string }
  | { type: 'session.end'; sessionId?: string }
  | { type: 'done'; sessionId?: string }
  // ── Agent coordination ──
  | { type: 'agent.spawn'; agentId: string; prompt: string }
  | { type: 'agent.complete'; agentId: string; result: string; usage: Usage }
  // ── Permission ──
  | { type: 'permission.request'; requestId: string; toolName: string; input: Record<string, unknown>; message: string; riskLevel: string }
  // ── Error / Status ──
  | { type: 'error.occurred'; message: string }
  | { type: 'status'; message: string }
  | { type: 'compact'; tokensBefore: number; tokensAfter: number; tokensFreed: number; strategies: string[] }
  // ── Visual mode — Conversational ──
  | { type: 'conversational.reply'; text: string; done: boolean; full?: string }
  // ── Visual mode — Plan / Phase ──
  | { type: 'plan.create'; plan: Record<string, unknown> }
  | { type: 'plan.complete'; artifactId?: string; widgetCount?: number }
  | { type: 'phase.start'; id: string; goal?: string }
  | { type: 'phase.complete'; id: string }
  | { type: 'phase.abandon'; id: string }
  | { type: 'phase.transition'; phaseId?: string; message?: string }
  | { type: 'critic.thinking'; phaseId?: string }
  | { type: 'milestone'; phaseId?: string }
  | { type: 'hil.requested'; question?: string; phaseId?: string }
  // ── Visual mode — Widget ──
  | { type: 'widget.open'; id: string; widgetType?: string; title?: string }
  | { type: 'widget.delta'; id: string; text: string }
  | { type: 'widget.close'; id: string; partial?: boolean }
  // ── Visual mode — Blocks ──
  | { type: 'block.text_start'; blockId?: string }
  | { type: 'block.text_delta'; text: string }
  | { type: 'block.text_end' }
  | { type: 'block.visual_start'; blockId?: string; visualType?: string }
  | { type: 'block.visual'; blockId?: string; visualType?: string; content?: string }

// ────────────────────────────────────────────
//  Session State
// ────────────────────────────────────────────

export interface PromptCacheLatches {
  autoModeHeaderLatched: boolean | null
  fastModeHeaderLatched: boolean | null
  thinkingClearLatched: boolean | null
}

export interface AgentHandle {
  id: string
  status: 'running' | 'completed' | 'failed' | 'killed'
  messages: Message[]
  onComplete: Promise<{ result: string; usage: Usage }>
}

export interface Settings {
  model?: string
  fallbackModel?: string
  customApiBaseUrl?: string
  customApiKey?: string
  permissionMode?: PermissionMode
  permissionRules?: PermissionRule[]
  mcpServers?: Record<string, MCPServerConfig>
  /** 外部 Hooks 配置（PreToolUse / PostToolUse / Stop） */
  hooks?: Record<string, unknown>
  /** Tavily API Key（WebSearch fallback，OpenAI provider 时使用） */
  tavilyApiKey?: string
  /** API Key 与 Provider 配置（从 config.ts 的 ApiConfig 对齐） */
  api?: {
    provider?: string
    anthropicApiKey?: string
    anthropicBaseUrl?: string
    openaiApiKey?: string
    openaiBaseUrl?: string
    model?: string
    fallbackModel?: string
  }
  /** Logger instance for structured logging */
  logger?: unknown
  /**
   * 由 UI 注入的额外 system prompt 内容（追加在静态区末尾）。
   * 用于 Artifacts 模式向 agent 注入 visual-protocol 等引导词。
   */
  systemPromptAddendum?: string
  /**
   * 开发模式 trace：启用后将完整会话事件流（消息、工具调用、token 用量等）
   * 写入用户主目录下 Blino projects/<hash>/<sessionId>.trace.jsonl（见 constants/blinoPaths），用于评测与迭代。
   * 可通过 --dev CLI flag 或在 settings.json 中设置 "devTrace": true 启用。
   */
  devTrace?: boolean
}

export interface MCPServerConfig {
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
}

export interface SessionState {
  sessionId: string
  cwd: string
  projectRoot: string

  messages: Message[]

  totalInputTokens: number
  totalOutputTokens: number
  totalCostUSD: number
  modelUsage: Map<string, { input: number; output: number; cacheRead: number }>

  permissionMode: PermissionMode
  permissionRules: PermissionRule[]
  denialCounts: Map<string, number>

  activeAgents: Map<string, AgentHandle>

  promptCacheLatches: PromptCacheLatches
  systemPromptSectionCache: Map<string, string | null>

  /** sessionMemoryCompact 用：上次摘要到哪条消息的 id（跨 compact 持久化） */
  lastSummarizedMessageId?: string
  /** autoCompact 触发追踪（记录 snip 已释放 token 量，避免重复触发） */
  autoCompactTracking?: { snipTokensFreed: number; lastCompactTurn: number }
  /**
   * 最后一次 API 调用实际返回的 inputTokens（来自 usage 字段）。
   * 用于 tokenCountWithEstimation：比字符估算更准确的上下文大小基准。
   */
  lastTurnInputTokens: number

  model: string
  fallbackModel?: string
  settings: Settings
  /**
   * Human-in-the-loop：权限 ask 下适配器返回 pending 或外部信令时置位；下一轮模型调用前在 agentLoop 中挂起，直到 hil_resume（或跨进程信令经文件桥接）。
   */
  hilPending: boolean
  /**
   * 工作流 DAG 执行时各节点状态与输出（由 DAGEngine 写入，并持久化到 snapshot.json）
   */
  workflowSnapshot?: Record<string, WorkflowNodeSnapshot>
  /**
   * AgentTool 子 agent 一次运行的快照：messages 摘要 + usage + 结果/错误（与 snapshot.json 的 subAgentSnapshots 对应）
   */
  workflowSubAgentSnapshots?: Record<string, AgentSnapshot>
  /**
   * Orchestrator 主 agent 模式：在 buildSystemPrompt 中注入调度职责说明（由 OrchestratorAgent 设置）
   */
  orchestratorSystemPreamble?: string
}

// ────────────────────────────────────────────
//  Context Provider
// ────────────────────────────────────────────

export interface ContextProvider {
  name: string
  placement: 'static' | 'dynamic'
  cacheBreak: boolean
  compute(session: SessionState): Promise<string | null>
  priority?: number
}

// ────────────────────────────────────────────
//  API Client
// ────────────────────────────────────────────

export interface SystemPromptBlock {
  text: string
  cacheScope?: 'global' | 'ephemeral' | null
}

export interface CallModelParams {
  model: string
  systemPrompt: SystemPromptBlock[]
  messages: Message[]
  tools: APIToolSchema[]
  maxOutputTokens?: number
  temperature?: number
  signal?: AbortSignal
  /** Prompt Cache Latch 状态（由 agentLoop 传入，API client 读取并应用 sticky headers） */
  promptCacheLatches?: PromptCacheLatches
}

export interface APIToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
  deferLoading?: boolean
}

export interface APIClient {
  callModel(params: CallModelParams): AsyncGenerator<StreamEvent>
}

// ────────────────────────────────────────────
//  UI Adapter
// ────────────────────────────────────────────

export interface PermissionRequest {
  tool: Tool
  input: Record<string, unknown>
  permissionResult: PermissionResult
}

export type PermissionResponse =
  | { decision: 'allow' }
  | { decision: 'allow_always' }
  | { decision: 'deny' }
  /** 适配器不阻塞：由 HIL 在 agentLoop 中挂起，进程内 eventBus + 文件桥接恢复 */
  | { decision: 'pending' }

export interface UIAdapter {
  onStreamEvent(event: StreamEvent): void
  onToolStart(toolName: string, input: Record<string, unknown>): void
  onToolEnd(toolName: string, result: ToolResult): void
  onError(error: Error): void

  getUserInput(): AsyncGenerator<string>

  requestPermission(request: PermissionRequest): Promise<PermissionResponse>

  init?(): Promise<void>
  destroy?(): Promise<void>
}
