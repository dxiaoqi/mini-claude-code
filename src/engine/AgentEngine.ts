/**
 * AgentEngine — 顶层编排器
 *
 * 负责：
 *   1. 将用户输入封装为 Message 并追加到 state
 *   2. 构建 canUseTool 回调（桥接权限引擎 + UI 适配器的权限交互）
 *   3. 启动 agentLoop 并将 StreamEvent 分发到 UIAdapter
 *   4. 录入 Transcript
 *
 * state 是直接引用传递：agentLoop 内部直接修改 state.messages 等属性，
 * caller（CLI）持有的 state 引用始终能看到最新数据。
 */

import type {
  CanUseToolFn,
  ContextProvider,
  Message,
  PermissionResult,
  SessionState,
  Tool,
  UIAdapter,
  APIClient,
} from '../types.js'
import { agentLoop, type AgentLoopResult } from './agentLoop.js'
import { checkToolPermission } from '../permissions/engine.js'
import { recordDenial } from '../permissions/engine.js'
import { dateContextProvider } from '../context/providers/dateContext.js'
import { recordTranscript } from '../state/transcript.js'

export interface AgentEngineConfig {
  apiClient: APIClient
  tools: Tool[]
  adapter: UIAdapter
  contextProviders?: ContextProvider[]
  maxTurns?: number
  /** AskUserTool 回调（交互模式下注入，pipe 模式为 undefined） */
  askUser?: (question: string, options?: Array<{ id: string; label: string }>) => Promise<string>
  /** MCP 资源工具使用 */
  mcpManager?: { getAllConnections(): unknown[] }
}

/**
 * 构建 canUseTool 回调：
 *   1. 调用权限引擎 checkToolPermission
 *   2. 如果结果是 'ask'，通过 UIAdapter 请求用户确认
 *   3. 用户选择 'allow_always' 时将规则写入 state
 *   4. 用户拒绝时记录 denial（3 次后 fallback to prompting）
 */
function buildCanUseTool(
  state: SessionState,
  config: AgentEngineConfig,
  abortController: AbortController,
): CanUseToolFn {
  return async (tool, input, _assistantMessage): Promise<PermissionResult> => {
    const toolContext = {
      sessionState: state,
      cwd: state.cwd,
      abortController,
      options: { tools: config.tools, mainModel: state.model },
      logger: state.settings?.logger as any,
    }

    const result = await checkToolPermission(tool, input, toolContext)

    if (result.behavior === 'ask') {
      const response = await config.adapter.requestPermission({
        tool,
        input,
        permissionResult: result,
      })

      switch (response.decision) {
        case 'allow':
          return { behavior: 'allow' }
        case 'allow_always':
          // 写入 session 级 allow 规则（持久化在 CLI 退出时处理）
          state.permissionRules = [
            ...state.permissionRules,
            { tool: tool.name, decision: 'allow', source: 'session' },
          ]
          return { behavior: 'allow' }
        case 'deny':
          // 记录拒绝次数（3 次后 fallback to prompting）
          recordDenial(state, tool.name)
          return { behavior: 'deny', reason: 'User denied permission' }
      }
    }

    return result
  }
}

/**
 * 运行 Agent 循环：发送用户消息 → 流式响应 → 工具执行 → 直到完成。
 *
 * state 是直接引用：agentLoop 修改 state.messages 等属性，
 * 调用方的 state 引用自动反映最新状态（如 /status 查看 token 数）。
 */
export async function runAgentLoop(
  state: SessionState,
  config: AgentEngineConfig,
  userContent: string | import('../types.js').ContentBlock[],
): Promise<AgentLoopResult> {
  // 追加用户消息
  const userMessage: Message = { role: 'user', content: userContent }
  state.messages = [...state.messages, userMessage]
  await recordTranscript(state, userMessage).catch(() => {})

  const abortController = new AbortController()
  const contextProviders: ContextProvider[] = [
    ...(config.contextProviders || []),
    dateContextProvider,
  ]

  const canUseTool = buildCanUseTool(state, config, abortController)

  const loop = agentLoop({
    state,
    apiClient: config.apiClient,
    tools: config.tools,
    contextProviders,
    canUseTool,
    maxTurns: config.maxTurns,
    signal: abortController.signal,
    askUser: config.askUser,
    mcpManager: config.mcpManager,
  })

  let result: AgentLoopResult = { reason: 'completed', turnCount: 0 }

  for (;;) {
    const iterResult = await loop.next()
    if (iterResult.done) {
      result = iterResult.value as AgentLoopResult
      break
    }

    const event = iterResult.value
    config.adapter.onStreamEvent(event)

    if (event.type === 'tool_use_start') {
      config.adapter.onToolStart(event.name, event.input)
    }
    if (event.type === 'tool_result') {
      config.adapter.onToolEnd(event.toolName, { data: event.result })
    }
    if (event.type === 'error') {
      config.adapter.onError(event.error)
    }
  }

  return result
}
