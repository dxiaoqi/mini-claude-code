# 02 — API 客户端与流式通信（Phase 1A）

## 设计目标

支持两种主流 API 格式，统一输出为 `AsyncGenerator<StreamEvent>`。

```
             ┌─ anthropicClient.ts ─→ Anthropic SDK stream
APIClient ──┤
             └─ client.ts ──────────→ OpenAI SDK stream
                                          ↓
                                  AsyncGenerator<StreamEvent>
```

## 核心接口

```typescript
interface APIClient {
  callModel(params: CallModelParams): AsyncGenerator<StreamEvent>
}
```

所有消费者（agentLoop、AgentEngine）只依赖这个接口。换 provider 只需换实现。

## Anthropic 客户端的关键设计

### 流式工具执行的时机

原始实现有一个严重问题：在 `finalMessage()` 之后才 yield `tool_use_start`，这意味着工具只能在 API 响应完全结束后才开始执行。

**优化后**：在流式 `content_block_stop` 事件时即 yield：

```typescript
case 'content_block_start':
  if (block.type === 'tool_use') {
    // 记录 tool_use 的 id 和 name
    currentToolUseId = block.id
    currentToolUseName = block.name
    currentToolUseJson = ''
  }
  break

case 'content_block_delta':
  if (delta.type === 'input_json_delta' && currentToolUseId) {
    // 增量累积 tool input JSON
    currentToolUseJson += delta.partial_json
  }
  break

case 'content_block_stop':
  if (currentToolUseId) {
    // tool_use block 结束 → 解析完整 input → 立即 yield
    const input = JSON.parse(currentToolUseJson || '{}')
    yield { type: 'tool_use_start', id: currentToolUseId, name: currentToolUseName, input }
    // StreamingToolExecutor 可以立即开始执行这个工具
  }
  break
```

这样 `StreamingToolExecutor` 可以在 API 还在生成后续内容时就开始执行工具。

### Prompt Cache 支持

```typescript
// 构建 system blocks 时根据 cacheScope 添加 cache_control
const systemBlocks = params.systemPrompt.map(block => ({
  type: 'text',
  text: block.text,
  // cacheScope: 'global' → 告诉 Anthropic 这部分可以跨会话缓存
  ...(block.cacheScope ? { cache_control: { type: 'ephemeral' } } : {}),
}))
```

## OpenAI 客户端的消息格式转换

Anthropic 和 OpenAI 的消息格式差异很大。关键转换点：

```typescript
// Anthropic: tool_result 是 content block 的一部分
{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '...' }] }

// OpenAI: tool result 是独立的 'tool' 角色消息
{ role: 'tool', tool_call_id: 'x', content: '...' }

// Anthropic: tool_use 是 assistant content block
{ role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {...} }] }

// OpenAI: tool_use 是 assistant.tool_calls 数组
{ role: 'assistant', tool_calls: [{ id: 'x', type: 'function', function: { name: 'Bash', arguments: '...' } }] }
```

## 重试与降级

```typescript
// withRetry: 指数退避，可重试 429/500/502/503/529
const retriedClient = withRetry(baseClient, { maxRetries: 2 })

// withFallback: 主模型失败后切换到备用模型
const apiClient = withFallback(retriedClient, 'claude-3-haiku-20240307')
```

`FallbackTriggeredError` 是一个特殊错误类型——`withRetry` 在用尽重试后抛出它，`withFallback` 捕获后用备用模型重新请求。
