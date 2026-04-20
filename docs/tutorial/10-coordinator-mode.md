# 10 — Coordinator 多 Agent 模式（Phase 2B）

## 设计灵感

原版 Claude Code 的 Coordinator 模式把 AI 从"单线程助手"变成"多 Agent 协调者"。Coordinator 自己不碰文件，只负责：

1. 理解用户需求
2. 拆分为子任务
3. 派 Worker 并行执行
4. 综合结果

## 架构

```
┌─────────────────── Coordinator Agent ───────────────────┐
│                                                          │
│  System Prompt: coordinatorPrompt.ts                     │
│  Tools: Agent + SendMessage + TaskStop + TaskOutput      │
│         + TodoWrite (仅编排工具，无文件/bash)             │
│                                                          │
├──────────────────── Worker Pool ────────────────────────┤
│                                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                 │
│  │Worker A │  │Worker B │  │Worker C │   ...            │
│  │Research │  │Implement│  │Verify  │                   │
│  │Bash,File│  │FileEdit │  │Bash,Test│                  │
│  │Glob,Grep│  │FileWrite│  │Grep    │                   │
│  └─────────┘  └─────────┘  └─────────┘                 │
│                                                          │
│  共享: Scratchpad 临时目录 (/tmp/blino-scratchpad-*)│
│  隔离: 各自独立的 messages 上下文                         │
│  回传: <task-notification> XML                           │
└──────────────────────────────────────────────────────────┘
```

## Coordinator Prompt 设计思路

### 1. 工具集限制

```typescript
const COORDINATOR_TOOL_NAMES = new Set([
  'Agent', 'SendMessage', 'TaskStop', 'TaskOutput', 'TodoWrite', 'ToolSearch',
])

// 过滤：Coordinator 只拿到编排工具
const coordinatorTools = config.allTools.filter(t => COORDINATOR_TOOL_NAMES.has(t.name))
```

**为什么不给 Coordinator 文件工具？** 因为：
- 强制它委派，不会"偷懒"自己做
- Worker 有独立上下文，Coordinator 的上下文保持干净
- 并行效率最大化

### 2. 四阶段工作流

这是 prompt 中最核心的指导：

```
Phase 1: Research（并行）
  → 多个 Worker 同时调查代码库

Phase 2: Synthesis（Coordinator 自己做！）
  → 综合所有研究结果，制定实施规格
  → "This is where YOUR intelligence matters most"

Phase 3: Implementation（并行）
  → Worker 按精确指令修改代码

Phase 4: Verification（新 Worker）
  → 独立验证，避免实现偏见
```

**为什么 Synthesis 必须 Coordinator 自己做？** 因为 Worker 只看到自己的研究结果，无法看到全局。只有 Coordinator 有全部信息，所以综合分析不能委派。

### 3. 并行是超能力

```
Bad (sequential):
  Agent("find API routes") → wait → Agent("find tests") → wait

Good (parallel):
  Agent("find API routes") + Agent("find tests") + Agent("check schema")
  — all in one message
```

LLM 在同一条消息中可以调用多个工具。Prompt 中明确鼓励这种行为。

### 4. Continue vs. Spawn 决策

| 情况 | 动作 | 原因 |
|------|------|------|
| 研究正好探索了要编辑的文件 | SendMessage | Worker 已有文件上下文 |
| 研究广泛但实现窄 | 新 Agent | 避免拖带噪声 |
| 修复失败或扩展工作 | SendMessage | Worker 有错误上下文 |
| 验证别人写的代码 | 新 Agent | 验证者需要新视角 |

### 5. Worker prompt 必须自包含

```
Rule 7: Worker prompts must be self-contained — workers can't see your
previous conversation. Include all necessary context in the prompt.
```

这是一个容易犯的错误：Coordinator 说"按照之前讨论的方案修改 API"，但 Worker 完全不知道"之前讨论"的内容。prompt 必须包含完整信息。

## Scratchpad 共享目录

```typescript
// 启动时创建临时目录
const scratchpadDir = await mkdtemp(join(tmpdir(), 'blino-scratchpad-'))

// Worker 可以在 scratchpad 中读写文件，无需权限确认
// 用于跨 Worker 传递：研究笔记、实施规格、中间文件
```

## 使用示例

```bash
# CLI flag
npx tsx src/cli.ts --coordinator

# 环境变量
BLINO_COORDINATOR=1 npx tsx src/cli.ts

# 实际使用
> 帮我重构 src/api/ 目录，把所有 Provider 合并成一个统一的接口

# Coordinator 会：
# 1. 派 3 个 Worker 并行研究每个 Provider 文件
# 2. 自己综合分析，制定统一接口设计
# 3. 派 Worker 按设计修改代码
# 4. 派新 Worker 运行测试验证
```
