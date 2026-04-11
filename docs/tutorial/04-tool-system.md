# 04 — 工具系统（Phase 1A–1B）

## Tool 接口的设计智慧

一个好的 Tool 接口需要回答这些问题：

1. **是什么**：name, description, inputSchema
2. **能做什么**：call()
3. **安全吗**：checkPermissions(), isReadOnly(), isDestructive()
4. **会影响缓存吗**：backfillObservableInput()
5. **能中断吗**：interruptBehavior()
6. **需要立即加载吗**：shouldDefer, alwaysLoad

## 编写一个工具的完整模板

以 FileReadTool 为例：

```typescript
export const FileReadTool: Tool<Input, Output> = {
  name: 'FileRead',
  aliases: ['FileReadTool', 'Read'],  // 兼容多种叫法
  description: '读取文件内容，支持行范围',

  inputSchema: z.object({
    file_path: z.string().describe('文件路径'),
    offset: z.number().optional().describe('起始行号（1-indexed）'),
    limit: z.number().optional().describe('读取行数'),
  }),

  // 安全标记
  isReadOnly() { return true },           // 纯读取，无副作用
  isConcurrencySafe() { return true },    // 多个 FileRead 可以并行

  // 权限：读操作直接通过
  async checkPermissions() {
    return { behavior: 'allow' }
  },

  // Prompt Cache 保护：展开相对路径给 observers
  backfillObservableInput(input) {
    if (typeof input.file_path === 'string' && !isAbsolute(input.file_path)) {
      input.file_path = resolve(input.file_path)  // 只修改克隆副本
    }
  },

  // 结果大小限制
  maxResultSizeChars: 200_000,

  // 核心执行
  async call(input, context) {
    const filePath = resolve(context.cwd, input.file_path)
    const raw = await readFile(filePath, 'utf-8')
    const lines = raw.split('\n')
    // ... 行号处理 ...
    return { data: { content: numbered.join('\n'), ... } }
  },

  // 结果序列化为 API 格式
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: output.content }
  },
}
```

## BashTool 的 4 级分类

BashTool 是最复杂的工具，因为 Shell 命令的风险跨度极大：

```typescript
// permissions/bashClassifier.ts
type BashRiskLevel = 'safe_read' | 'safe_write' | 'needs_confirmation' | 'dangerous'

// 1. 危险命令（直接拒绝）
const DANGEROUS_COMMANDS = [
  /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+[\/~]/,  // rm -rf /
  /mkfs\./,                                              // 格式化
  /curl\s[^|]*\|\s*(bash|sh|zsh)/,                      // 管道到 shell
  ...
]

// 2. 安全读命令（自动通过）
const SAFE_READ_PREFIXES = ['ls', 'cat', 'git status', 'grep', ...]

// 3. 安全写命令（需确认但不危险）
const SAFE_WRITE_PREFIXES = ['mkdir', 'npm install', 'git commit', ...]

// 4. 其余 → needs_confirmation
```

**多命令处理**：`npm install && npm test` 按 `&&` 拆分，取最高风险级别。

## StreamingToolExecutor — 流式并行

原版 Claude Code 的设计：工具在 API 流式响应**过程中**就开始执行，不等响应结束。

```typescript
// agentLoop 中：
for await (const event of apiStream) {
  if (event.type === 'tool_use_start') {
    streamingExecutor.addTool(block)  // 立即启动！不等流结束
  }
}

// 流结束后，工具可能已经执行完了
const results = await streamingExecutor.getRemainingResults()
```

**中断安全**：用户在工具执行过程中提交新消息时：

```typescript
private updateInterruptibleState(): void {
  const executing = this.tools.filter(t => t.status === 'executing')
  // 只有所有执行中的工具都标记为 'cancel' 时，才允许中断
  const allCancellable = executing.every(t => this.getToolInterruptBehavior(t) === 'cancel')
  this.toolContext.setHasInterruptibleToolInProgress?.(allCancellable)
}
```

FileWriteTool 默认 `'block'`（不可中断）→ 保护写操作安全。

## 工具注册表与 ToolSearch

```typescript
// registry.ts — 简单的数组 + 查找
function findToolByName(name: string, tools?: Tool[]): Tool | undefined {
  return pool.find(t => t.name === name || t.aliases?.includes(name))
}

// ToolSearchTool — 搜索 deferred 工具
async call(input) {
  const keywords = input.query.toLowerCase().split(/\s+/)
  const scored = allTools.map(tool => {
    let score = 0
    for (const kw of keywords) {
      if (tool.name.toLowerCase().includes(kw)) score += 3
      if (tool.description.toLowerCase().includes(kw)) score += 1
    }
    return { tool, score }
  })
  return scored.filter(s => s.score > 0).sort(...)
}
```

## zodToJsonSchema — Zod 到 API Schema

OpenAI/Anthropic API 需要 JSON Schema 格式的工具参数描述。`zodToJsonSchema` 将 Zod schema 转换为标准 JSON Schema：

```typescript
// z.object({ file_path: z.string().describe('文件路径') })
// → { type: 'object', properties: { file_path: { type: 'string', description: '文件路径' } }, required: ['file_path'] }
```

这避免了引入 `zod-to-json-schema` 这样的大依赖。
