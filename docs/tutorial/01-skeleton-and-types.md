# 01 — 项目骨架与类型系统（Phase 0）

## 这一步做什么

从零开始：创建项目、安装依赖、定义所有核心类型。类型系统是整个项目的骨架——所有模块通过 `types.ts` 中的接口通信。

## package.json 关键依赖

```json
{
  "type": "module",              // ESM 模块
  "dependencies": {
    "@anthropic-ai/sdk": "^0.82.0",  // Anthropic API
    "openai": "^4.85.0",             // OpenAI 兼容 API
    "zod": "^3.24.0",                // 工具输入 Schema 校验
    "commander": "^13.1.0",          // CLI 参数解析
    "chalk": "^5.4.0",               // 终端彩色输出
    "fast-glob": "^3.3.0",           // GlobTool 用
    "@modelcontextprotocol/sdk": "^1.29.0"  // MCP 协议
  }
}
```

## 类型系统设计思路

### Message — 对话的原子

```typescript
// 三种角色
type UserMessage = { role: 'user'; content: string | ContentBlock[] }
type AssistantMessage = { role: 'assistant'; content: string | ContentBlock[] }
type SystemMessage = { role: 'system'; content: string; type?: 'compact_boundary' | 'tombstone' }

// content 不是简单 string —— 它可以是混合内容块
type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock
```

**为什么 content 是 `string | ContentBlock[]`？** 因为 API 对话中，一条 assistant 消息可能同时包含文字回复和多个工具调用：

```typescript
// 一条 assistant 消息的典型内容
{
  role: 'assistant',
  content: [
    { type: 'text', text: '让我帮你查看文件。' },
    { type: 'tool_use', id: 'tu_1', name: 'FileRead', input: { file_path: 'src/main.ts' } },
    { type: 'tool_use', id: 'tu_2', name: 'Glob', input: { pattern: '*.json' } },
  ]
}
```

### Tool — AI 的能力单元

```typescript
interface Tool<Input = any, Output = any> {
  name: string
  inputSchema: z.ZodType<Input>          // Zod schema → API JSON Schema
  call(input, context, canUseTool, parentMessage): Promise<ToolResult<Output>>

  // 权限三件套
  checkPermissions(input, context): Promise<PermissionResult>
  isReadOnly?(input): boolean
  isDestructive?(input): boolean

  // Prompt Cache 保护
  backfillObservableInput?(input: Record<string, unknown>): void

  // 中断安全
  interruptBehavior?(): 'cancel' | 'block'

  // 延迟加载
  readonly shouldDefer?: boolean
  readonly alwaysLoad?: boolean
}
```

**关键设计：`checkPermissions` 返回四态**

```typescript
type PermissionResult =
  | { behavior: 'allow' }        // 直接执行
  | { behavior: 'ask'; message: string }    // 请求用户确认
  | { behavior: 'deny'; reason: string }    // 直接拒绝
  | { behavior: 'passthrough'; message: string }  // 交给通用权限引擎决定
```

大多数工具返回 `passthrough`（"我没有特殊意见，交给引擎"）。BashTool 有完整的 4 级分类逻辑，所以返回具体的 allow/ask/deny。

### StreamEvent — 引擎到 UI 的通信协议

```typescript
type StreamEvent =
  | { type: 'text_delta'; text: string }        // AI 正在打字
  | { type: 'tool_use_start'; id; name; input } // 开始调用工具
  | { type: 'tool_result'; toolName; result }    // 工具执行完毕
  | { type: 'message_end'; usage; stopReason }   // 一轮结束
  | { type: 'turn_complete'; turnCount; usage }  // 一个 turn 完成
  | { type: 'error'; error: Error }              // 错误
  | { type: 'agent_spawn'; agentId; prompt }     // 子 Agent 启动
  | ...
```

**所有 UI 都通过消费 `StreamEvent` 来渲染**。Terminal 适配器看到 `text_delta` 就 `process.stdout.write()`；Web UI 看到同样的事件就更新 DOM。引擎层不知道也不关心 UI 是什么。

### SessionState — 单一真相源

```typescript
interface SessionState {
  sessionId: string
  messages: Message[]              // 完整对话历史
  totalInputTokens: number         // 累计 token
  permissionMode: PermissionMode   // 权限模式
  permissionRules: PermissionRule[] // 权限规则
  promptCacheLatches: PromptCacheLatches // Cache 保护
  systemPromptSectionCache: Map<string, string | null> // Prompt Section 缓存
  activeAgents: Map<string, AgentHandle> // 活跃子 Agent
  model: string
  settings: Settings
}
```

一个对象持有所有会话状态。`agentLoop` 直接修改它的属性，CLI 中的 `/status` 直接读取它。
