# 07 — 压缩管线（Phase 1E）

## 为什么需要压缩

LLM 的上下文窗口有限（128K–200K token）。长对话中工具结果积累迅速——一次 `cat` 大文件可能 50K token，几轮后就接近上限。

原版 Claude Code 设计了一套**分层递进**的压缩管线，从免费（不调 API）到有成本（调 API），从主动（每轮预处理）到被动（413 恢复）。

## 5 层管线

```
每轮 turn 预处理（主动压缩）:
  messages
    ↓ ① snipCompact       — 归档 >20 轮前的完整对话（无 API）
    ↓ ② microCompact      — 清除旧工具输出详情（无 API）
    ↓ ③ contextCollapse    — staged 折叠 stale 片段（无 API）
    ↓ ④ autoCompact        — 超 100K token 时触发：
         ├→ sessionMemory   — 智能窗口切片（无 API）
         └→ apiCompact      — LLM 摘要（有 API 成本）

413 恢复（被动压缩）:
  prompt_too_long 错误
    ↓ ⑤ collapse.drain()   — 提交 staged 折叠 → 重试
    ↓ ⑥ reactiveCompact    — 紧急 API 摘要 → 重试
    ↓ 都失败 → 退出
```

## 各层详解

### ① snipCompact — 历史裁剪（最轻量）

```typescript
// 从尾部数 assistant 轮数，超过 20 轮的全部移到归档
for (let i = messages.length - 1; i >= 0; i--) {
  if (messages[i].role === 'assistant') turnCount++
  if (turnCount >= 20) {
    cutoffIndex = i
    break
  }
}

// 被裁掉的消息 → snipArchive（可恢复！）
snipArchive.push({ timestamp, messages: snipped, tokensFreed })

// 替换为摘要 boundary
const boundary = {
  role: 'system',
  content: `[42 messages archived. Topics: ... | Tools used: ...]`,
  type: 'compact_boundary',
}
```

**关键设计：归档而非销毁**。`restoreLastSnip()` 可以恢复最近一次归档。

### ② microCompact — 局部清理（最常触发）

```typescript
// 对 >5 轮前的 COMPACTABLE_TOOLS 的 tool_result：
// 保留元数据，清除正文

// 之前：
"File: src/main.ts (200 lines)\n     1|import ...\n     2|...(200行内容)"

// 之后：
"[Old tool result content cleared to save context]
Tool: FileRead | File: src/main.ts | 200 lines"
```

不调 API，不丢失关键信息（文件名、命令行、匹配数），只清除详细内容。

### ③ contextCollapse — 上下文折叠

```
"staged" 折叠：
  User: 帮我找到所有 API 路由
  Assistant: [调用了 Grep 和 Glob]
  User: [tool results]
  Assistant: 找到了 5 个文件...

    ↓ 折叠为

  [System]: [Collapsed 4 messages] User asked about API routes → Found 5 files
```

折叠是 **staged**（暂存）的——正常 turn 中应用为"视图"，不真正删除原始消息。413 时 **drain** 提交所有暂存折叠，释放真实 token。

### ④ autoCompact — 自动触发

```typescript
const totalTokens = estimateMessagesTokens(messages)

if (totalTokens < 80_000)  → 不压缩
if (totalTokens < 100_000) → 发出 warning
if (totalTokens >= 100_000) {
  // 优先：sessionMemoryCompact（无 API 调用）
  const smResult = trySessionMemoryCompaction(messages)
  if (smResult) return smResult

  // 回退：apiCompact（调 LLM 生成摘要）
  const apiResult = await apiCompact({ messages, apiClient, model })
  return apiResult
}
```

### sessionMemoryCompact — 智能窗口切片

```typescript
// 从尾部累积 token，确保保留窗口满足：
//   minTokens: 10K（至少保留这么多）
//   minTextBlockMessages: 5（至少保留 5 条有文本的消息）
//   maxTokens: 40K（不超过这么多）

// adjustIndexToPreserveAPIInvariants:
// 保证 tool_use 和 tool_result 配对完整
// 如果切点落在一对中间，向前调整
```

### ⑤⑥ 413 恢复

在 agentLoop 的 catch 块中触发：

```
413 → drain collapses → 有释放 → continue（重试）
413 → drain 无效 → reactiveCompact → 有结果 → continue
413 → 都失败 → return { reason: 'prompt_too_long' }
```

## Token 估算

```typescript
function estimateStringTokens(str: string): number {
  let tokens = 0
  for (const char of str) {
    if (char.charCodeAt(0) > 0x2E80) {
      tokens += 1.5  // CJK 字符 ~1.5 token
    } else {
      tokens += 0.25 // ASCII 字符 ~0.25 token
    }
  }
  return Math.ceil(tokens)
}
```

粗略但够用——用于阈值判断，不用于计费。

## pipeline.ts — 编排器

```typescript
class CompactPipeline {
  async run(messages, apiClient, model) {
    // 按序执行，每步可能修改 messages
    const snipResult = snipCompactIfNeeded(messages)
    const microResult = microCompact(snipResult.messages)
    const collapseResult = this.collapseManager.applyCollapsesIfNeeded(microResult)
    const autoResult = await autoCompactIfNeeded(collapseResult.messages, ...)
    return { messages: autoResult.messages, wasCompacted: ..., strategies: [...] }
  }

  drainCollapses(messages) {
    return this.collapseManager.drain(messages)
  }
}
```
