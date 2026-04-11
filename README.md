# Mini Claude Code

一个思路对齐 Claude Code 的轻量级 AI 编程助手。保留核心 Agent 能力，精简架构，为后续扩展预留接口。

## 快速开始

```bash
# 安装依赖
npm install

# 交互模式（Anthropic 兼容 API）
ANTHROPIC_API_KEY=your_key ANTHROPIC_BASE_URL=https://api.example.com npx tsx src/cli.ts

# 交互模式（OpenAI 兼容 API）
OPENAI_API_KEY=your_key OPENAI_BASE_URL=https://api.example.com/v1 npx tsx src/cli.ts

# 管道模式（自动批准所有工具调用）
echo "列出当前目录文件" | ANTHROPIC_API_KEY=xxx ANTHROPIC_BASE_URL=xxx npx tsx src/cli.ts -p

# 指定模型
npx tsx src/cli.ts --model claude-sonnet-4-20250514

# Coordinator 多 Agent 模式
npx tsx src/cli.ts --coordinator
```

## CLI 参数

| 参数 | 说明 |
|------|------|
| `--api-key <key>` | API Key（或设置 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`） |
| `--base-url <url>` | API Base URL（或设置 `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`） |
| `--model <model>` | 模型名称（默认：auto detect） |
| `--provider <type>` | API Provider：`anthropic` 或 `openai`（自动检测） |
| `-p, --pipe` | 管道模式：从 stdin 读取，自动批准工具 |
| `--bypass-permissions` | 自动批准所有工具调用 |
| `--coordinator` | Coordinator 模式（多 Agent 协调） |

## REPL 命令

| 命令 | 说明 |
|------|------|
| `/exit` | 退出 |
| `/clear` | 清空会话（重置消息、token、权限规则、快照） |
| `/compact` | 手动触发上下文压缩（调用 LLM 生成对话摘要） |
| `/status` | 查看当前会话状态（token 数、成本、消息数） |
| `/model <name>` | 切换模型 |
| `/undo [file]` | 回滚文件修改（无参数列出可回滚文件） |

## 架构概览

```
┌──────────────── 适配层（可替换）──────────────────┐
│  Terminal REPL / Pipe Mode / HTTP Server（未来）   │
├──────────────── 引擎层（核心）──────────────────┤
│  AgentEngine → agentLoop（while(true) 循环）       │
│  StreamingToolExecutor / CompactPipeline           │
├──────────────── 能力层（并列）──────────────────┤
│  API Client / Tool Registry / MCP Client           │
│  Permission Engine / Context Providers             │
└───────────────────────────────────────────────────┘
```

## 工具清单

### 核心工具（始终加载）

| 工具 | 说明 |
|------|------|
| **Bash** | Shell 命令执行（含 4 级危险分类） |
| **FileRead** | 读取文件（支持行范围） |
| **FileEdit** | 精确字符串替换编辑 |
| **FileWrite** | 创建/覆盖文件 |
| **Glob** | 文件名模式搜索 |
| **Grep** | 文件内容正则搜索（rg 优先，grep fallback） |
| **TodoWrite** | 任务列表管理 |
| **AskUser** | 向用户提问等待回答 |
| **Skill** | 执行自定义 Skill 工作流 |
| **Agent** | 派生子 Agent 独立执行任务 |
| **SendMessage** | 向已有 Agent 发消息 |
| **TaskStop** | 停止运行中的 Agent |
| **TaskOutput** | 获取 Agent 输出 |
| **ToolSearch** | 发现 deferred 工具 |

### Deferred 工具（通过 ToolSearch 加载）

| 工具 | 说明 |
|------|------|
| **WebFetch** | 网页抓取 + HTML→Markdown 转换 |
| **NotebookEdit** | Jupyter Notebook 编辑 |
| **ImageRead** | 图片读取（base64 → Vision API） |
| **PDFRead** | PDF 文本提取 |
| **ListMcpResources** | 列出 MCP 资源 |
| **ReadMcpResource** | 读取 MCP 资源 |

### MCP 动态工具

通过 `.mini-claude/settings.json` 配置 MCP 服务器后自动发现。

## 权限系统

### 四级命令分类（BashTool）

| 级别 | 示例 | 行为 |
|------|------|------|
| `safe_read` | `ls`, `cat`, `git status` | 自动通过 |
| `safe_write` | `npm install`, `git commit` | 需确认（passthrough） |
| `needs_confirmation` | `rm file`, `sudo ...` | 强制确认（ask） |
| `dangerous` | `rm -rf /`, `mkfs`, `curl|bash` | 直接拒绝（deny） |

### 权限决策流程

```
Tool 请求
  ↓
① tool.validateInput()         — Zod schema 校验
② tool.checkPermissions()      — 工具级检查（allow/ask/deny/passthrough）
③ 规则引擎匹配                — session > project > user > cli 优先级
④ PermissionMode 决策          — bypass/auto/plan/default
⑤ passthrough → ask 转换
⑥ 请求用户确认                — Allow / Always Allow / Deny
```

### 规则持久化

- Session 级规则在退出时写入 `.mini-claude/settings.local.json`
- 启动时从 user / project / local 三级配置加载

## 上下文压缩管线

```
每轮 turn 预处理:
  messages
    ↓ ① snipCompact       — 归档 >20 轮前的完整对话（可恢复）
    ↓ ② microCompact      — 清除旧工具输出详情（保留元数据）
    ↓ ③ contextCollapse    — staged 折叠 stale 片段
    ↓ ④ autoCompact        — 超 100K token 时：
         ├→ sessionMemory   — 智能窗口切片（无 API）
         └→ apiCompact      — LLM 摘要压缩（有 API）

413 恢复链:
  prompt_too_long
    ↓ collapse.drain()     — 提交 staged 折叠 → 重试
    ↓ reactiveCompact      — 紧急 API 压缩 → 重试
    ↓ 都失败 → 退出
```

## Context Provider（可注入上下文）

```typescript
import type { ContextProvider } from './types'

// 自定义 Context Provider
const myProvider: ContextProvider = {
  name: 'project_conventions',
  placement: 'dynamic',
  cacheBreak: false,  // false = 会话内只计算一次
  priority: 25,
  async compute(session) {
    return fs.readFile('.conventions.md', 'utf-8')
  },
}
```

内置 Providers：`ClaudeMd` / `Memory` / `GitContext` / `Date`

## Skill 系统

在 `.mini-claude/skills/` 下创建 Markdown 文件：

```markdown
---
name: commit
description: 生成 commit 信息并提交
allowedTools: [Bash]
---

分析 git diff --cached，生成 Conventional Commits 格式的提交信息，然后执行 git commit。
```

使用：AI 会自动调用 `SkillTool({ skill: "commit" })`

## MCP 配置

`.mini-claude/settings.json`：

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "test.db"]
    },
    "remote": {
      "transport": "http",
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

## Coordinator 模式

多 Agent 协调模式，将 AI 变为任务协调者：

```bash
npx tsx src/cli.ts --coordinator
# 或
MINI_CLAUDE_COORDINATOR=1 npx tsx src/cli.ts
```

工作流：Research（并行）→ Synthesis（Coordinator）→ Implementation（并行）→ Verification（并行）

## 目录结构

```
src/
├── cli.ts                          # CLI 入口
├── types.ts                        # 核心类型定义
├── index.ts                        # 库导出
├── engine/                         # 引擎层
│   ├── AgentEngine.ts              # 顶层编排
│   ├── agentLoop.ts                # while(true) 循环
│   ├── StreamingToolExecutor.ts    # 流式并行工具执行
│   ├── toolResultBudget.ts         # 结果大小限制
│   └── coordinator/                # Coordinator 多 Agent 模式
├── api/                            # API 客户端
│   ├── anthropicClient.ts          # Anthropic 兼容
│   ├── client.ts                   # OpenAI 兼容
│   └── retry.ts                    # 重试 + 降级
├── tools/                          # 工具（18+ 个）
│   ├── local/                      # 本地工具
│   ├── network/                    # 网络工具
│   ├── content/                    # 内容处理
│   ├── agent/                      # Agent 管理
│   └── interaction/                # 交互工具
├── permissions/                    # 权限引擎
├── compact/                        # 5 层压缩管线
├── context/                        # 上下文 + Skill
├── mcp/                            # MCP 协议
├── state/                          # 状态管理
├── adapters/                       # UI 适配
└── utils/                          # 工具函数
```
