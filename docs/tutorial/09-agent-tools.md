# 09 — Agent 工具与子任务（Phase 1F）

## 为什么需要子 Agent

单 Agent 的问题：
1. **上下文污染**：研究阶段的大量 grep/cat 结果留在上下文中，影响后续实现的质量
2. **不能并行**：一次只能做一件事
3. **上下文溢出**：复杂任务容易超出窗口限制

子 Agent 解决方案：独立的消息上下文，执行完毕后只返回结果摘要。

## 4 个 Agent 工具

| 工具 | 作用 | 类比 |
|------|------|------|
| **Agent** | 派生新 Worker | `fork()` |
| **SendMessage** | 向已有 Worker 发消息 | `worker.postMessage()` |
| **TaskStop** | 终止 Worker | `worker.terminate()` |
| **TaskOutput** | 查询 Worker 状态 | `worker.status` |

## AgentTool 的核心实现

### 工厂模式

AgentTool 不是静态对象，而是通过 `createAgentTool()` 工厂函数创建。因为它需要引用 `apiClient` 和 `allTools`（在 CLI 启动后才确定）。

```typescript
export function createAgentTool(
  apiClient: APIClient,       // 共享 API 客户端
  allTools: Tool[],           // Worker 可用的工具列表
  contextProviders: ContextProvider[],
  canUseTool: CanUseToolFn,   // Worker 的权限回调
): Tool<Input, Output> { ... }
```

### 隔离机制

```typescript
// 创建隔离的子 Agent 状态：共享配置，独立消息
const agentState = {
  ...context.sessionState,        // 继承 CWD、模型、设置
  sessionId: `${parentId}-agent-${agentId}`,  // 独立 session
  messages: [],                   // 空白消息历史
  totalInputTokens: 0,           // 独立 token 计数
  totalOutputTokens: 0,
  activeAgents: new Map(),       // 不能递归派生（防止爆炸）
}
```

### Usage 累加

子 Agent 完成后，将其 token 用量累加到父级 state：

```typescript
handle.status = 'completed'
// 父级 state 反映子 Agent 的消耗
context.sessionState.totalInputTokens += totalUsage.inputTokens
context.sessionState.totalOutputTokens += totalUsage.outputTokens
```

这样 `/status` 显示的 token 数包含了所有子 Agent 的用量。

### task-notification XML

AgentTool 的结果以 XML 格式返回，便于 Coordinator 模式解析：

```xml
<task-notification>
  <task-id>a1b2c3d4</task-id>
  <status>completed</status>
  <summary>Found 5 API route files...</summary>
  <result>详细的 Worker 输出文本</result>
  <usage>
    <total_tokens>3500</total_tokens>
    <tool_uses>4</tool_uses>
    <duration_ms>8200</duration_ms>
  </usage>
</task-notification>
```

### 权限策略

```typescript
// CLI 中 createAgentTool 的 canUseTool 回调：
async (tool, input, msg) => {
  if (isPipe || bypassPermissions) return { behavior: 'allow' }

  // 交互模式：读操作自动通过，写操作走权限检查
  if (tool.isReadOnly?.(input)) return { behavior: 'allow' }
  return checkToolPermission(tool, input, toolContext)
}
```

## SendMessageTool — 续写子任务

```typescript
// 找到 Worker → 追加消息到它的 messages
handle.messages.push({ role: 'user', content: input.message })
```

**注意**：当前实现中 SendMessage 只追加消息，不重新启动 Worker 的 agentLoop。这是一个简化——完整实现需要 Worker 持续运行并监听新消息。

## TaskOutputTool — 轮询进度

```typescript
// 遍历 Worker 的 messages，找到最后一条 assistant 消息
for (let i = handle.messages.length - 1; i >= 0; i--) {
  if (messages[i].role === 'assistant') {
    return extractTextContent(messages[i])
  }
}
```

Coordinator 用这个工具检查 Worker 是否完成、结果是什么。
