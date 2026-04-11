# 03 — Agent 循环核心（Phase 1A）

## 这是整个项目最重要的文件

`engine/agentLoop.ts` 实现了 AI "自主行动"的核心：一个 `while(true)` 循环，每次迭代就是一个"思考-行动-观察"周期。

## 循环结构

```
while (true) {
  Phase 0: 上下文预处理
    ├→ applyToolResultBudget()     — 超限结果持久化到磁盘
    └→ CompactPipeline.run()        — 5 层压缩管线

  Phase 1: 构建 System Prompt
    └→ buildSystemPrompt(state, tools, contextProviders)

  Phase 2: 过滤 deferred 工具，构建 API schema
    └→ filterActiveTools() — 只发送非 deferred 工具给 API

  Phase 3: 流式 API 调用
    ├→ apiClient.callModel()       — AsyncGenerator
    ├→ yield StreamEvent           — 透传给 UIAdapter
    ├→ backfillObservableInput()   — 克隆 input 给 observers
    └→ streamingExecutor.addTool() — 流式过程中启动工具执行

  Phase 4: 收集工具结果
    ├→ streamingExecutor.getRemainingResults()
    ├→ 追加 assistant 消息 + tool_result 消息
    └→ continue（进入下一轮）

  Phase 5: 终止判定
    ├→ max_output_tokens 恢复（最多 3 次，提升到 64K）
    └→ 无工具调用 → return { reason: 'completed' }
}
```

## 核心代码解析

### AsyncGenerator 模式

```typescript
export async function* agentLoop(params): AsyncGenerator<StreamEvent, AgentLoopResult> {
  // yield 是"透传事件给 UI"
  // return 是"循环结束，返回原因"
  while (true) {
    for await (const event of apiStream) {
      yield event  // 每个流式事件立即透传
    }
    return { reason: 'completed', turnCount }
  }
}
```

调用方通过 `for...of` 消费事件，通过 `.next().done` 获取返回值：

```typescript
const loop = agentLoop(params)
for (;;) {
  const { value, done } = await loop.next()
  if (done) {
    result = value  // AgentLoopResult
    break
  }
  adapter.onStreamEvent(value)  // StreamEvent
}
```

### backfillObservableInput — Prompt Cache 保护

这是一个精妙的设计。问题场景：

1. AI 返回 `tool_use` block，其中 `file_path` 是相对路径 `./src/main.ts`
2. 权限引擎需要绝对路径来匹配规则
3. 但是！这个 `tool_use` block 会在下一轮作为 `messages` 发回给 API
4. 如果我们直接修改 `input.file_path` 为绝对路径，**序列化字节变了，Prompt Cache 失效**

解决方案：**在克隆副本上修改，给 observers 看丰富版，保持原始对象不变**：

```typescript
if (event.type === 'tool_use_start') {
  const tool = findToolByName(event.name)
  let yieldEvent = event  // 默认 yield 原始事件

  if (tool?.backfillObservableInput) {
    const inputClone = { ...event.input }      // 克隆
    tool.backfillObservableInput(inputClone)    // 在克隆上丰富
    yieldEvent = { ...event, input: inputClone } // yield 丰富版
  }

  yield yieldEvent  // observers (UI, transcript) 看到丰富版

  // 但存入 assistantContentBlocks 的是原始 input（cache-safe）
  const block: ToolUseBlock = { type: 'tool_use', id: event.id, name: event.name, input: event.input }
  assistantContentBlocks.push(block)
}
```

### 413 恢复链

```typescript
catch (err) {
  // 检测到 prompt_too_long
  if (statusCode === 413) {
    // 第一步：drain staged 折叠（释放 token，不调 API）
    const drainResult = compactPipeline.drainCollapses(state.messages)
    if (drainResult.committed > 0) {
      state.messages = drainResult.messages
      continue  // 重试
    }

    // 第二步：reactive compact（调 API 做紧急摘要）
    if (!hasAttemptedReactiveCompact) {
      hasAttemptedReactiveCompact = true
      const result = await tryReactiveCompact({ messages: state.messages, ... })
      if (result) {
        state.messages = result.messages
        continue  // 重试
      }
    }

    // 都失败 → 退出
    return { reason: 'prompt_too_long', turnCount }
  }
}
```

### Deferred Loading — 节省 token

```typescript
function filterActiveTools(tools: Tool[], discoveredNames: Set<string>): Tool[] {
  return tools.filter(tool => {
    if (tool.alwaysLoad) return true            // SkillTool: turn 1 就需要
    if (tool.name === 'ToolSearch') return true  // ToolSearch 自己不能被 defer
    if (!tool.shouldDefer) return true           // 核心工具：始终包含
    return discoveredNames.has(tool.name)        // deferred 工具：被发现后才包含
  })
}
```

WebFetchTool、PDFReadTool 等标记了 `shouldDefer: true`，API 调用时不包含它们的 schema。当 AI 调用 `ToolSearch({ query: 'pdf' })` 后，`discoveredNames` 里加入了 `PDFRead`，下一轮 API 调用就会包含它。

**效果**：初始 tool schema 更短，节省 ~2000 token prompt。

## 状态更新策略

所有状态更新都是**直接修改 state 属性**：

```typescript
// 新数组赋值（不可变的消息数组）
state.messages = [...state.messages, assistantMessage]

// 直接累加（可变的计数器）
accumulateUsage(state, event.usage, currentModel)
```

这保证了外部持有的 `state` 引用始终能看到最新数据（例如 CLI 的 `/status` 命令）。
