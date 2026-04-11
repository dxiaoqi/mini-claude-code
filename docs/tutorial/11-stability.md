# 11 — 稳定性与恢复机制（Phase 1C）

## 生产级 AI Agent 需要什么

一个 demo 级别的 Agent 只需要 API 调用 + 工具执行。但要在真实场景中可靠运行，还需要：

1. **网络容错**：API 超时、限流、服务器错误
2. **输出恢复**：AI 回复被截断时自动续写
3. **上下文溢出**：prompt 太长时优雅降级
4. **文件安全**：AI 修改文件后可以撤销
5. **会话持久**：断开后可以恢复对话

## API 重试与退避

```typescript
// api/retry.ts
export function withRetry(client: APIClient, config: RetryConfig): APIClient {
  return {
    async *callModel(params) {
      for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
          yield* client.callModel(params)
          return
        } catch (err) {
          const statusCode = extractStatusCode(err)
          const isRetryable = [429, 500, 502, 503, 529].includes(statusCode)

          if (!isRetryable || attempt === config.maxRetries) {
            if (fallbackModel) throw new FallbackTriggeredError(err, fallbackModel)
            throw err
          }

          // 指数退避 + 随机抖动
          const delay = Math.min(
            baseDelay * Math.pow(2, attempt) + Math.random() * 500,
            maxDelay,
          )
          await sleep(delay)
        }
      }
    }
  }
}
```

**指数退避**：1s → 2s → 4s（加随机 0-500ms 抖动避免雷群效应）。

## 模型降级

```typescript
// FallbackTriggeredError 触发降级
// withRetry 抛出 → withFallback 捕获 → 用备用模型重试

const retriedClient = withRetry(baseClient, { maxRetries: 2 })
const apiClient = withFallback(retriedClient, 'claude-3-haiku')

// 主模型 503 → 重试 2 次 → 都失败 → FallbackTriggeredError
// → withFallback 捕获 → yield "[Switched to fallback model]"
// → 用 claude-3-haiku 重新请求
```

## max_output_tokens 恢复

AI 的回复可能因为 token 限制被截断。agentLoop 检测到 `stopReason === 'length'` 后：

```
第 1 次截断：静默提升 maxOutputTokens 到 64K
第 2-3 次截断：注入恢复消息 "Resume directly from where you stopped"
第 4 次截断：放弃，报错
```

```typescript
if (stopReason === 'length' || stopReason === 'max_tokens') {
  maxOutputTokensRecoveryCount++

  if (maxOutputTokensRecoveryCount > 3) {
    return { reason: 'error', turnCount }
  }

  if (maxOutputTokensRecoveryCount === 1) {
    maxOutputTokensOverride = 64_000  // 提升到 64K
  }

  // 追加 assistant 消息（截断的部分）+ 恢复提示
  state.messages = [
    ...state.messages,
    assistantMessage,
    { role: 'user', content: 'Output token limit hit. Resume directly. Do not repeat.' },
  ]
  continue  // 重试
}
```

## 工具结果大小限制

```typescript
// engine/toolResultBudget.ts
// 超过 100K 字符的工具结果 → 持久化到磁盘

if (content.length > 100_000) {
  const filePath = `~/.mini-claude/overflow/${sessionId}/${toolUseId}.txt`
  await writeFile(filePath, content)

  const preview = content.slice(0, 500)
  return `${preview}\n\n[Output truncated: ${content.length} chars. Full output: ${filePath}]`
}
```

这防止了 `cat` 大文件或 `find /` 撑爆上下文。

## 文件历史快照

每次写操作前自动拍快照：

```typescript
// agentLoop.ts 中：
if (!tool.isReadOnly?.(input)) {
  await takeSnapshot(state, absPath, tool.name)
}

// state/fileHistory.ts:
// 内存归档（热备）
snapshots.set(filePath, [...existing, { filePath, content, timestamp, toolName }])

// 磁盘归档（冷备）
await writeFile(`~/.mini-claude/snapshots/${sessionId}/${safeFileName}.snapshot`, content)
```

`/undo` 命令恢复最近的快照：

```
> /undo                    → 列出所有有快照的文件
> /undo src/main.ts        → 恢复 src/main.ts 到修改前的状态
```

## Transcript 持久化

每条消息都写入 JSONL 文件：

```
~/.mini-claude/projects/<hash>/<sessionId>.jsonl
```

格式：
```json
{"timestamp":"2026-04-06T10:30:00Z","role":"user","content":"帮我修复 bug"}
{"timestamp":"2026-04-06T10:30:02Z","role":"assistant","content":[{"type":"text","text":"让我看看..."},{"type":"tool_use",...}]}
{"timestamp":"2026-04-06T10:30:05Z","role":"user","content":[{"type":"tool_result",...}]}
```

支持 `loadTranscript(projectRoot, sessionId)` 恢复历史会话（为未来的 `--resume` 功能预留）。
