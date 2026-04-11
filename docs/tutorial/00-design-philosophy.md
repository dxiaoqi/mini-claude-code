# 00 — 设计哲学：从 Claude Code 到 Mini 版

## 为什么要做 Mini 版？

Claude Code 是 Anthropic 的官方 AI 编程助手 CLI 工具。通过逆向工程学习其源码后，我们发现它有 50+ 工具、5 层架构、React/Ink 终端 UI、多种运行模式 —— 非常完整，但也非常复杂。

Mini 版的目标是：**思路对齐，架构精简**。保留核心 Agent 能力的设计智慧，用更少的代码量实现可运行的系统。

## 三层 vs 五层

```
Claude Code 原版（5 层）              Mini 版（3 层）
─────────────────────────────────────────────────
层1 交互层 (React/Ink REPL)     →    适配层（readline/pipe/http）
层2 编排层 (QueryEngine.ts)     ┐
层3 核心循环 (query.ts)         ┘→   引擎层（AgentEngine + agentLoop 融合）
层4 工具层 (tools.ts/Tool.ts)   ┐
层5 通信层 (claude.ts)          ┘→   能力层（API Client / Tools / MCP / Permissions 并列）
```

**为什么融合编排层和核心循环？** 原版分离是因为 React/Ink 需要 QueryEngine 作为 hooks/state 的中间层。我们不用 React，所以不需要这层。

## 关键设计决策

### 1. 内核与 UI 彻底解耦

```typescript
// 引擎层不依赖任何 UI 框架
// UIAdapter 接口定义了引擎与 UI 的全部交互契约
interface UIAdapter {
  onStreamEvent(event: StreamEvent): void
  getUserInput(): AsyncGenerator<string>
  requestPermission(request: PermissionRequest): Promise<PermissionResponse>
}

// Terminal REPL 和 Web UI 都是这个接口的实现
class TerminalAdapter implements UIAdapter { ... }
class PipeAdapter implements UIAdapter { ... }
```

这意味着：换 UI 只需实现一个新 adapter，引擎代码零改动。

### 2. 流式优先

整个系统的数据流是 `AsyncGenerator<StreamEvent>`：

```
API Server → AsyncGenerator → agentLoop → yield event → UIAdapter
```

用户看到"逐字打出"的效果，工具在流式过程中就开始执行（StreamingToolExecutor）。

### 3. 状态直接引用

```typescript
// 不是 Redux/Zustand，不是 React Context
// 就是一个普通的 TypeScript 对象
const state: SessionState = createSessionState({ cwd: process.cwd() })

// agentLoop 直接修改 state 的属性
state.messages = [...state.messages, newMessage]  // 新数组赋值
state.totalInputTokens += usage.inputTokens        // 直接累加
```

原版用了 Bootstrap State 单例 + Zustand AppState 双系统，是因为 React 需要响应式更新。我们用直接引用 + 属性赋值，简单且无 bug。

### 4. 技术选型对比

| 领域 | Claude Code | Mini 版 | 选择理由 |
|------|-------------|---------|----------|
| 运行时 | Bun 强绑定 | Node.js/Bun 均可 | 兼容性 |
| UI | React/Ink (fork) | readline + chalk | 不引入框架 |
| 状态 | Zustand + 单例 | 普通对象 | 够用 |
| Schema | Zod | Zod | 保持一致 |
| CLI | Commander.js | Commander.js | 保持一致 |

## 文件结构设计

```
src/
├── cli.ts           # 入口：解析参数 → 选择模式 → 运行引擎
├── types.ts         # 所有公共类型（Message/Tool/State/StreamEvent/...）
├── index.ts         # 库导出
├── engine/          # 引擎层：agentLoop + StreamingToolExecutor
├── api/             # API 客户端：OpenAI + Anthropic + 重试降级
├── tools/           # 工具：按 local/network/content/agent/interaction 分类
├── permissions/     # 权限：规则引擎 + Bash 分类器
├── context/         # 上下文：ContextProvider + Skill + systemPrompt
├── compact/         # 压缩管线：5 层 + 413 恢复
├── mcp/             # MCP 协议：客户端 + 工具适配 + 配置
├── state/           # 状态：SessionState + Transcript + 文件快照
├── adapters/        # UI 适配：Terminal REPL + Pipe
└── utils/           # 工具函数：消息/配置/成本/zodToJsonSchema
```

每个目录是一个关注点，目录间通过 `types.ts` 中的接口解耦。
