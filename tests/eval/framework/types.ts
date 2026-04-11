/**
 * Evaluation Framework — 核心类型定义
 *
 * GRAPE 评测模型：
 *   G - Goal        意图对齐（是否正确理解用户意图）
 *   R - Reasoning   推理规划（是否制定合理计划）
 *   A - Action      行动执行（工具调用效率/正确性）
 *   P - Proof       结果验证（是否主动验证工作）
 *   E - Expression  沟通表达（向用户汇报的准确性）
 */

// ─── 任务定义 ───────────────────────────────────────────────────────────────

export type TaskLevel = 'S' | 'M' | 'L'

export type TaskCategory =
  | 'intent'       // 意图理解（含模糊意图）
  | 'planning'     // 任务规划（含多步依赖）
  | 'execution'    // 代码执行（含工具调用效率）
  | 'verification' // 结果验证（含主动测试）
  | 'multiagent'   // 多 Agent 协调
  | 'research'     // 研究场景（搜索 + 综合 + 落地）

export interface TestCase {
  id: string
  level: TaskLevel
  category: TaskCategory
  title: string
  description: string

  // 测试环境
  fixture?: string                                  // fixtures/generators 中的模板名
  setup?: (env: TestEnvironment) => Promise<void>   // 额外初始化

  // 输入
  prompt: string               // 用户输入（可以模糊/带歧义）
  systemContext?: string       // 注入到 CLAUDE.md 的上下文
  useCoordinator?: boolean     // 是否启用 Coordinator 模式

  // 验证器（顺序执行，全部通过才算 Functional Pass）
  validators: Validator[]

  // 评分权重（覆盖默认值）
  weights?: Partial<GRAPEWeights>

  // 约束
  maxTurns: number
  timeoutMs?: number           // 默认 120000ms

  // Research 场景专用
  researchTargets?: string[]   // 期望 Agent 搜索/分析的关键点
  expectedDecision?: string    // 期望的最终技术决策
}

// ─── 验证器 ──────────────────────────────────────────────────────────────────

export type Validator =
  // 文件系统验证
  | { type: 'file_exists'; path: string; description?: string }
  | { type: 'file_not_exists'; path: string; description?: string }
  | { type: 'file_contains'; path: string; pattern: string | RegExp; description?: string }
  | { type: 'file_not_contains'; path: string; pattern: string | RegExp; description?: string }
  | { type: 'file_line_count'; path: string; min?: number; max?: number }

  // 命令验证（在沙箱 cwd 执行）
  | { type: 'command_success'; command: string; description?: string }
  | { type: 'command_output_contains'; command: string; contains: string; description?: string }
  | { type: 'command_exit_code'; command: string; code: number; description?: string }

  // 行为验证（分析 Agent trace）
  | { type: 'tool_called'; toolName: string; minTimes?: number; maxTimes?: number }
  | { type: 'tool_not_called'; toolName: string; description?: string }
  | { type: 'asked_clarification'; description?: string }    // 面对模糊意图时主动提问
  | { type: 'verified_result'; description?: string }        // 主动运行测试/编译
  | { type: 'used_planning'; description?: string }          // 使用了 TodoWrite
  | { type: 'agent_spawned'; minAgents?: number }            // 启动了子 Agent

  // LLM Judge（语义评判，会调用模型）
  | { type: 'llm_judge'; criterion: string; minScore: number; description?: string }

  // 自定义
  | { type: 'custom'; fn: (env: TestEnvironment, trace: AgentTrace) => Promise<ValidatorResult> }

export interface ValidatorResult {
  passed: boolean
  score: number      // 0-1
  message: string
  details?: unknown
}

// ─── Trace（记录 Agent 执行过程）────────────────────────────────────────────

export interface AgentTrace {
  sessionId: string
  startTime: number
  endTime: number
  durationMs: number
  turnCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUSD: number

  toolCalls: ToolCallRecord[]
  messages: MessageRecord[]
  agentSpawns: number          // 子 Agent 数量
  compactionCount: number      // 上下文压缩次数
  permissionDenials: number    // 权限拒绝次数
  recoveryAttempts: number     // 错误恢复次数

  finalResponse: string        // 最后一条 assistant 消息
  exitReason: 'completed' | 'max_turns' | 'timeout' | 'error'
}

export interface ToolCallRecord {
  id: string
  name: string
  input: Record<string, unknown>
  output?: string
  isError: boolean
  durationMs: number
  turnIndex: number
}

export interface MessageRecord {
  role: 'user' | 'assistant' | 'system'
  content: string
  turnIndex: number
  hasToolUse: boolean
  hasToolResult: boolean
}

// ─── GRAPE 评分 ──────────────────────────────────────────────────────────────

export interface GRAPEScore {
  goal: number        // 0-100: 意图对齐度
  reasoning: number   // 0-100: 规划质量
  action: number      // 0-100: 执行效率
  proof: number       // 0-100: 验证行为
  expression: number  // 0-100: 沟通质量
  composite: number   // 加权总分
}

export interface GRAPEWeights {
  goal: number
  reasoning: number
  action: number
  proof: number
  expression: number
}

export const DEFAULT_WEIGHTS: Record<TaskLevel, GRAPEWeights> = {
  S: { goal: 0.40, reasoning: 0.10, action: 0.25, proof: 0.15, expression: 0.10 },
  M: { goal: 0.25, reasoning: 0.25, action: 0.20, proof: 0.20, expression: 0.10 },
  L: { goal: 0.20, reasoning: 0.25, action: 0.15, proof: 0.20, expression: 0.20 },
}

// Research 场景专用权重调整
export const RESEARCH_WEIGHTS: GRAPEWeights =
  { goal: 0.25, reasoning: 0.20, action: 0.15, proof: 0.15, expression: 0.25 }

// ─── 评测结果 ────────────────────────────────────────────────────────────────

export interface EvalResult {
  testCase: TestCase
  trace: AgentTrace
  validatorResults: Array<{ validator: Validator; result: ValidatorResult }>
  grape: GRAPEScore

  // 派生指标
  functionalPass: boolean    // 所有 Validator 是否全通过
  passRate: number           // 通过的 Validator 比例
  firstFailure?: string      // 第一个失败的 Validator 描述

  // 元数据
  runAt: string              // ISO timestamp
  durationMs: number
  sandboxPath: string
  error?: string             // 框架级错误（非 Agent 失败）
}

export interface TestSuiteResult {
  suiteName: string
  runAt: string
  totalCases: number
  passedCases: number
  failedCases: number
  passRate: number

  byLevel: Record<TaskLevel, LevelSummary>
  byCategory: Record<TaskCategory, CategorySummary>
  grapeAverage: GRAPEScore

  results: EvalResult[]
}

export interface LevelSummary {
  total: number
  passed: number
  avgCompositeScore: number
  avgDurationMs: number
  avgTurns: number
}

export interface CategorySummary {
  total: number
  passed: number
  avgCompositeScore: number
  topFailurePatterns: string[]
}

// ─── 运行时环境 ──────────────────────────────────────────────────────────────

export interface TestEnvironment {
  cwd: string          // 沙箱工作目录（每个用例独立 tmpdir）
  fixtureDir: string   // fixture 模板目录
  traceDir: string     // trace 输出目录
}

export interface EvalConfig {
  apiKey: string
  baseUrl?: string
  model: string
  provider: 'anthropic' | 'openai'
  parallel: number          // 并发用例数（建议 1-3）
  outputDir: string         // 报告输出目录
  llmJudgeEnabled: boolean  // 是否启用 LLM Judge（有成本）
  verbose: boolean
  filter?: {
    levels?: TaskLevel[]
    categories?: TaskCategory[]
    ids?: string[]
  }
}
