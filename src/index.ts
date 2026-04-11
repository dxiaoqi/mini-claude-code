/**
 * index.ts — 库入口
 *
 * 重导出所有公开 API：类型、客户端、会话状态、引擎循环、工具与适配器等。
 */
export type {
  Tool,
  ToolContext,
  ToolResult,
  PermissionResult,
  PermissionMode,
  PermissionRule,
  Message,
  UserMessage,
  AssistantMessage,
  StreamEvent,
  SessionState,
  APIClient,
  CallModelParams,
  UIAdapter,
  ContextProvider,
  Settings,
} from './types.js'

export { createOpenAICompatibleClient } from './api/client.js'
export { createAnthropicClient } from './api/anthropicClient.js'
export { createSessionState, accumulateUsage, clearSession } from './state/SessionState.js'
export { runAgentLoop } from './engine/AgentEngine.js'
export { agentLoop } from './engine/agentLoop.js'
export { checkToolPermission } from './permissions/engine.js'
export { buildSystemPrompt, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from './context/systemPrompt.js'
export { findToolByName, getAllTools, registerTool, getAPIToolSchemas } from './tools/registry.js'

// Tools
export { BashTool } from './tools/local/BashTool.js'
export { FileReadTool } from './tools/local/FileReadTool.js'
export { FileEditTool } from './tools/local/FileEditTool.js'
export { FileWriteTool } from './tools/local/FileWriteTool.js'
export { GlobTool } from './tools/local/GlobTool.js'
export { GrepTool } from './tools/local/GrepTool.js'
export { NotebookEditTool } from './tools/local/NotebookEditTool.js'
export { WebFetchTool } from './tools/network/WebFetchTool.js'
export { createWebSearchTool } from './tools/network/WebSearchTool.js'
export { ImageReadTool } from './tools/content/ImageReadTool.js'
export { PDFReadTool } from './tools/content/PDFReadTool.js'
export { createToolSearchTool } from './tools/ToolSearchTool.js'

// Context providers
export { claudeMdProvider } from './context/providers/claudemd.js'
export { memoryProvider } from './context/providers/memory.js'
export { gitContextProvider } from './context/providers/gitContext.js'
export { dateContextProvider } from './context/providers/dateContext.js'

// Adapters
export { TerminalAdapter } from './adapters/terminal.js'
export { PipeAdapter } from './adapters/pipe.js'

// API helpers
export { withRetry, withFallback, FallbackTriggeredError } from './api/retry.js'

// State helpers
export { recordTranscript, flushTranscript, loadTranscript, listSessions } from './state/transcript.js'
export { takeSnapshot, restoreSnapshot, listSnapshotFiles, clearSnapshots } from './state/fileHistory.js'

// Engine helpers
export { applyToolResultBudget } from './engine/toolResultBudget.js'

// Compact pipeline
export { CompactPipeline } from './compact/pipeline.js'
export { snipCompactIfNeeded, getSnipArchive, restoreLastSnip, clearSnipArchive } from './compact/snipCompact.js'
export { microCompact } from './compact/microCompact.js'
export { ContextCollapseManager } from './compact/contextCollapse.js'
export { trySessionMemoryCompaction } from './compact/sessionMemoryCompact.js'
export { tryReactiveCompact } from './compact/reactiveCompact.js'
export { apiCompact } from './compact/apiCompact.js'
export { autoCompactIfNeeded } from './compact/autoCompact.js'
export { estimateTokens, estimateMessagesTokens } from './compact/tokenEstimator.js'

// Permissions
export { classifyBashCommand } from './permissions/bashClassifier.js'

// MCP
export { MCPClientManager } from './mcp/client.js'
export { adaptMCPTools } from './mcp/toolAdapter.js'
export { listMCPResources, readMCPResource } from './mcp/resourceAdapter.js'
export { loadMCPConfigs } from './mcp/config.js'

// Skills
export { loadSkills } from './context/skills.js'
export { SkillTool, invalidateSkillCache } from './tools/interaction/SkillTool.js'
export { TodoWriteTool, getCurrentTodos, clearTodos } from './tools/interaction/TodoWriteTool.js'
export { AskUserTool } from './tools/interaction/AskUserTool.js'

// Agent tools
export { createAgentTool } from './tools/agent/AgentTool.js'
export { SendMessageTool } from './tools/agent/SendMessageTool.js'
export { TaskStopTool } from './tools/agent/TaskStopTool.js'
export { TaskOutputTool } from './tools/agent/TaskOutputTool.js'

// Engine
export { StreamingToolExecutor } from './engine/StreamingToolExecutor.js'
export { runCoordinatorMode, isCoordinatorMode, buildTaskNotification } from './engine/coordinator/coordinatorMode.js'
export { getCoordinatorSystemPrompt, getCoordinatorUserContext } from './engine/coordinator/coordinatorPrompt.js'

// Port manager
export { findAvailablePort, isPortFree, readServerLock, writeServerLock, clearServerLock } from './utils/portManager.js'

// Utils
export { estimateCost, formatCost, formatTokens } from './utils/cost.js'
export { createUserMessage, createAssistantMessage, normalizeMessagesForAPI, extractTextContent } from './utils/messages.js'
export { loadSettings, saveSetting, persistPermissionRules, loadPermissionRules } from './utils/config.js'
export { processAttachments, buildContentWithAttachments } from './utils/attachments.js'
export { runPreToolUseHooks, runPostToolUseHooks, runStopHooks } from './utils/hooks.js'
