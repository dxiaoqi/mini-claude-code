# Blino 使用手册

> 版本 0.1.0 · AI agent CLI + 可视化 UI

---

## 目录

1. [快速开始](#1-快速开始)
2. [配置](#2-配置)
3. [CLI 使用](#3-cli-使用)
4. [UI 界面](#4-ui-界面)
5. [Workflow 工作流](#5-workflow-工作流)
6. [Skill 技能](#6-skill-技能)
7. [自定义 Tool](#7-自定义-tool)
8. [权限管理](#8-权限管理)
9. [MCP 集成](#9-mcp-集成)
10. [目录结构参考](#10-目录结构参考)

---

## 1. 快速开始

### 安装

```bash
npm install -g blino
# 或在项目内使用
npm install blino
```

### 配置 API Key

```bash
blino --api-key sk-xxx
# 或写入配置文件
```

也可以在 `~/.blino/settings.json` 里配置：

```json
{
  "api": {
    "provider": "anthropic",
    "anthropicApiKey": "sk-xxx",
    "model": "claude-opus-4-5"
  }
}
```

### 启动交互式对话

```bash
# 终端交互模式
blino

# 启动 Web UI（推荐）
blino --tui
```

---

## 2. 配置

### 配置文件位置

| 文件 | 作用 |
|---|---|
| `~/.blino/settings.json` | 全局配置（API key、模型、权限等） |
| `<项目>/.blino/settings.local.json` | 项目级配置，覆盖全局配置 |

### 主要配置项

```json
{
  "api": {
    "provider": "anthropic",
    "anthropicApiKey": "sk-xxx",
    "openaiApiKey": "sk-xxx",
    "model": "claude-sonnet-4-6",
    "fallbackModel": "claude-haiku-4-5",
    "anthropicBaseUrl": "https://api.anthropic.com",
    "openaiBaseUrl": "https://api.openai.com/v1"
  },
  "permissionMode": "default",
  "tavilyApiKey": "tvly-xxx"
}
```

### 支持的 API Provider

| Provider | 值 | 说明 |
|---|---|---|
| Anthropic | `anthropic` | 使用 Claude 系列模型 |
| OpenAI 兼容 | `openai` | 兼容 OpenAI 接口的任意服务 |

### 查看当前配置

```bash
blino --config
```

---

## 3. CLI 使用

### 基本模式

```bash
# 交互式 REPL（默认）
blino

# 管道模式：从 stdin 读取输入，自动通过权限
echo "帮我生成一个 README" | blino --pipe

# 指定模型
blino --model claude-opus-4-6

# 恢复历史会话
blino --resume
blino --resume <sessionId>
```

### 服务模式

```bash
# 启动 HTTP server（供 Web UI 连接）
blino --serve

# 启动 server + 自动打开浏览器
blino --tui

# 指定端口和 host
blino --serve --port 3001 --host 0.0.0.0

# 指定 CORS origin
blino --serve --cors-origin http://localhost:3000
```

### Workflow 模式

```bash
# 列出所有可用 workflow
blino --workflow list

# 运行指定 workflow（使用配置的默认值）
blino --workflow run <workflowId>

# 强制重新运行所有节点（忽略快照）
blino --workflow run <workflowId> --fresh
```

### 其他选项

```bash
# 绕过所有权限检查（开发调试用）
blino --bypass-permissions

# Coordinator 模式（多 agent 编排）
blino --coordinator

# 开发者追踪模式（记录完整会话日志）
blino --dev

# 查看帮助
blino --help
```

### 会话内常用命令

在交互式模式下，可以输入以下命令：

| 命令 | 说明 |
|---|---|
| `/clear` | 清空当前对话上下文 |
| `/compact` | 手动压缩上下文 |
| `/undo` | 撤销上一条用户消息 |
| `/snapshot` | 创建文件快照 |
| `/restore` | 恢复文件快照 |
| `/cost` | 查看本次会话的 token 用量和费用 |
| `/help` | 查看所有命令 |
| `exit` / `quit` / Ctrl+C | 退出 |

---

## 4. UI 界面

### 启动

```bash
blino --tui
```

默认在 `http://localhost:3001` 启动，浏览器自动打开。

### 界面结构

```
┌─────────────────────────────────────────────┐
│  Artifacts          [模式] [会话] [设置] [主题] │  ← Header
├───────────────────────┬─────────────────────┤
│                       │                     │
│    消息列表区          │    可视化渲染区       │
│    (chat pane)        │    (artifact pane)  │
│                       │                     │
├───────────────────────┴─────────────────────┤
│  [ 输入框 / 菜单  ]      [模式切换] [发送]   │  ← 输入区
└─────────────────────────────────────────────┘
```

### 工作模式

通过输入区右侧的模式切换按钮切换：

| 模式 | 说明 |
|---|---|
| **Artifacts** | AI 生成可视化内容（SVG、HTML、图表），实时渲染在右侧面板 |
| **Agent** | AI 使用工具执行任务（文件操作、代码执行、网络搜索等） |

### `/` 命令菜单

在输入框输入 `/` 唤起全局命令菜单：

```
/                    ← 打开主菜单
/dem                 ← 搜索模式，实时过滤所有命令
```

主菜单分为四个分类：

| 分类 | 功能 |
|---|---|
| **Workflow** | 启动已注册的工作流 |
| **Skill** | 执行已安装的 skill |
| **新建会话** | 清空上下文开始新对话 |
| **设置** | 模型、API、偏好配置 |

键盘操作：`↑↓` 导航，`Enter` 选中，`Escape` 关闭，二级菜单按 `Escape` 返回上级。

### 会话管理

点击 Header 右侧的会话按钮，可以查看历史会话列表并切换。

### 权限弹窗

Agent 模式下，AI 执行高风险操作（如运行 Bash 命令、写入文件）时会弹出权限确认框：

- **允许一次**：本次操作放行
- **始终允许**：同类操作不再询问
- **拒绝**：取消本次操作

---

## 5. Workflow 工作流

Workflow 是一组按 DAG（有向无环图）结构组织的 agent 节点，用于执行多步骤、有明确流程的任务。

### 创建 Workflow

在项目 `.blino/workflows/` 目录下创建 JSON 文件：

```json
{
  "id": "content-pipeline",
  "name": "内容生成流水线",
  "description": "依次生成大纲、摘要、SEO 标题",
  "inputs": [
    {
      "id": "topic",
      "label": "内容主题",
      "type": "text",
      "placeholder": "例如：远程工作的利与弊",
      "required": true
    },
    {
      "id": "audience",
      "label": "目标受众",
      "type": "select",
      "options": ["职场新人", "管理者", "自由职业者"],
      "default": "职场新人",
      "required": true
    }
  ],
  "nodes": [
    {
      "id": "outline",
      "prompt": "你是一名内容策划。主题是「{{topic}}」，受众是「{{audience}}」。\n输出包含 3 个章节的大纲，每章节一行，格式：1. 章节标题。",
      "allowedTools": [],
      "dependsOn": [],
      "hilRequired": false
    },
    {
      "id": "summary",
      "prompt": "上一步大纲已在上下文中。主题「{{topic}}」，受众「{{audience}}」。\n为每个章节写一句话摘要，格式：1. 摘要内容。",
      "allowedTools": [],
      "dependsOn": ["outline"],
      "hilRequired": false
    }
  ]
}
```

### Workflow 字段说明

**顶层字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一标识，用于 CLI 命令和 URL |
| `name` | string | 显示名称 |
| `description` | string | 简介，显示在菜单里 |
| `inputs` | array | 启动前需要用户填写的参数 |
| `nodes` | array | 节点列表 |

**inputs 字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 变量名，在 prompt 里用 `{{id}}` 引用 |
| `label` | string | 表单显示名 |
| `type` | string | `text` / `textarea` / `select` / `date` |
| `options` | string[] | type 为 select 时的选项列表 |
| `default` | string | 默认值 |
| `required` | boolean | 是否必填 |

**nodes 字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 节点唯一标识 |
| `prompt` | string | 节点的执行指令，支持 `{{变量}}` 模板替换 |
| `allowedTools` | string[] | 允许使用的工具列表，`[]` 表示纯文本模式（不使用任何工具） |
| `dependsOn` | string[] | 前驱节点 id，全部完成后本节点才执行 |
| `hilRequired` | boolean | 是否需要人工审批后才执行 |

### 模板变量

在节点 prompt 里可以使用两种变量：

```
{{topic}}          ← 引用用户填写的 inputs 值
```

前驱节点的输出会自动拼入后续节点的上下文，格式如下：

```
## Previous step outputs

### outline
1. 章节一标题
2. 章节二标题

## Current step task

你的当前任务...
```

### 人工审批（HIL）

将节点的 `hilRequired` 设为 `true`，执行到该节点时 workflow 会暂停：

- **CLI 模式**：终端提示按 Enter 继续
- **UI 模式**：右下角弹出橙色审批 toast，点击批准/拒绝

拒绝后 workflow 停止，该节点标记为 failed。

### 断点续跑

workflow 执行过程中进程中断（Ctrl+C 或崩溃），再次运行时会从快照恢复：

```bash
blino --workflow run content-pipeline
# 已完成的节点显示 "skipped (snapshot found)"，只重跑未完成的节点
```

强制重新全量执行：

```bash
blino --workflow run content-pipeline --fresh
```

快照文件保存在：

```
~/.blino/projects/<hash>/workflow-run-<runId>.json
```

### 在 UI 里使用 Workflow

1. 输入 `/` 打开主菜单
2. 选择 **Workflow** 进入二级菜单
3. 选择目标 workflow
4. 填写参数表单（如有 inputs）
5. 点击「启动」

执行过程以 DAG 卡片形式展示在对话中，每个节点实时更新状态（待执行/执行中/完成/失败/等待审批）。

### Workflow 设计建议

对于 `allowedTools: []` 的纯文本节点，prompt 开头加一行约束可以防止模型尝试调用工具：

```
你的任务只是生成文本内容，不要调用任何工具或命令。
```

---

## 6. Skill 技能

Skill 是可复用的 prompt 模板，让 agent 按照预定义的方式执行特定任务。

### Skill 文件格式

Skill 是带 YAML frontmatter 的 Markdown 文件：

```markdown
---
name: git-commit
description: 分析 staged changes 并生成 commit message 然后提交
allowedTools: [Bash]
---
1. 用 git diff --staged 查看当前 staged changes
2. 分析变更内容，生成符合 Conventional Commits 规范的 commit message
   格式：<type>(<scope>): <description>
   type: feat/fix/docs/style/refactor/test/chore
3. 执行 git commit -m "<message>"
4. 告知用户提交结果
```

### Skill 存放位置

| 位置 | 路径 | 作用范围 |
|---|---|---|
| 项目级 | `<项目>/.blino/skills/` | 当前项目可用 |
| 用户级 | `~/.blino/skills/` | 所有项目可用 |

同名 skill 时，项目级优先于用户级。

### Skill frontmatter 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | skill 名称，调用时使用 |
| `description` | 是 | 一句话描述，显示在 `/` 菜单里 |
| `allowedTools` | 否 | 限定可用工具列表，如 `[Bash, FileRead]`，省略表示不限制 |

### 调用 Skill

在对话里直接告诉 agent：

```
帮我执行 git-commit skill
使用 code-review skill 检查这个文件
```

或通过 `/` 菜单选择 Skill 分类，找到对应 skill 后填写任务描述。

### 用 AI 创建 Skill

在对话里描述需求，AI 会自动生成 skill 文件：

```
帮我创建一个代码审查的 skill，要能检查可读性、性能和安全问题
```

AI 会：
1. 设计 skill 的名称、描述、工具约束
2. 生成完整的 prompt 正文
3. 写入 `.blino/skills/` 目录
4. skill 立刻可在菜单里使用

### Skill 设计建议

prompt 要具体，说明执行步骤而不是模糊的目标：

```markdown
# 好的写法
1. 用 git diff --staged 查看变更
2. 生成 Conventional Commits 格式的 message
3. 执行 git commit

# 避免的写法
分析代码变更并提交
```

`allowedTools` 能限定就限定，避免 agent 做超出预期的操作：

```markdown
---
allowedTools: [Bash]      ← 只需要执行命令时
allowedTools: [FileRead, Glob]   ← 只需要读文件时
---
```

---

## 7. 自定义 Tool

用户可以在 `.blino/tools/` 目录下定义自己的工具，agent 会自动发现并调用，支持文件热加载（新增/修改工具文件后 300ms 内生效，无需重启）。

### 声明式 HTTP 工具（JSON）

适合调用外部 REST API：

```json
{
  "name": "GetWeather",
  "description": "获取指定城市的实时天气信息",
  "parameters": {
    "city": {
      "type": "string",
      "description": "城市名称，例如：北京、上海",
      "required": true
    }
  },
  "executor": {
    "type": "http",
    "url": "https://wttr.in/{{city}}?format=3",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer {{env.WEATHER_API_KEY}}"
    },
    "responseType": "text",
    "timeoutMs": 8000
  }
}
```

**模板变量：**

| 语法 | 说明 |
|---|---|
| `{{city}}` | 引用工具入参 |
| `{{env.API_KEY}}` | 引用环境变量（不暴露在配置文件里） |

**executor 字段：**

| 字段 | 说明 |
|---|---|
| `type` | 固定为 `"http"` |
| `url` | 请求 URL，支持模板变量 |
| `method` | `GET` / `POST` / `PUT` / `DELETE` / `PATCH` |
| `headers` | 请求头，支持模板变量 |
| `body` | POST body，支持模板变量 |
| `responseType` | `json`（默认）或 `text` |
| `timeoutMs` | 超时毫秒数，默认 10000 |

### 脚本式工具（.tool.js）

文件名必须以 `.tool.js` 结尾：

```javascript
// .blino/tools/format-date.tool.js
export default {
  name: 'FormatDate',
  description: '将时间戳格式化为可读日期字符串',
  parameters: {
    timestamp: {
      type: 'number',
      description: 'Unix 时间戳（毫秒）',
      required: true,
    },
    format: {
      type: 'string',
      description: '格式：date / datetime / time',
      required: false,
      enum: ['date', 'datetime', 'time'],
    },
  },
  async execute({ timestamp, format = 'datetime' }) {
    const d = new Date(Number(timestamp))
    if (format === 'date') return d.toLocaleDateString('zh-CN')
    if (format === 'time') return d.toLocaleTimeString('zh-CN')
    return d.toLocaleString('zh-CN')
  },
}
```

### 工具优先级

用户工具与内置工具同名时，**用户工具优先**。

### 查看已加载的用户工具

```bash
curl http://localhost:3001/user-tools/list
```

---

## 8. 权限管理

### 权限模式

通过配置 `permissionMode` 设置全局权限策略：

| 模式 | 说明 |
|---|---|
| `default` | 高风险操作需要用户确认（推荐） |
| `bypass` | 自动通过所有权限检查（开发调试用） |

### 细粒度权限规则

在 `settings.json` 里配置 `permissionRules`，对特定工具或操作设置规则：

```json
{
  "permissionRules": {
    "Bash": "ask",
    "FileWrite": "allow",
    "WebSearch": "allow"
  }
}
```

| 规则值 | 说明 |
|---|---|
| `allow` | 自动允许 |
| `ask` | 每次询问 |
| `deny` | 自动拒绝 |

### 权限弹窗选项

| 选项 | 说明 |
|---|---|
| 允许一次 | 本次操作放行，下次同类操作仍会询问 |
| 始终允许 | 同类操作不再询问（写入权限规则） |
| 拒绝 | 取消本次操作 |

### Workflow 中的权限

Workflow 的 CLI 模式默认使用 `bypass` 权限（节点执行不会弹窗），UI 模式通过 HTTP server 运行，权限策略继承当前 session 配置。

---

## 9. MCP 集成

Blino 支持 MCP（Model Context Protocol）服务器，可以接入第三方工具和数据源。

### 配置 MCP

在 `.blino/settings.local.json` 或全局配置里添加：

```json
{
  "mcp": [
    {
      "name": "my-mcp-server",
      "type": "sse",
      "url": "https://my-mcp-server.com/sse"
    },
    {
      "name": "local-mcp",
      "type": "stdio",
      "command": "node",
      "args": ["./mcp-server.js"]
    }
  ]
}
```

### 使用 MCP 工具

MCP 工具加载后与内置工具平级，agent 可以直接调用。在对话里列出可用的 MCP 资源：

```
列出所有可用的 MCP 资源
```

---

## 10. 目录结构参考

### 用户目录（`~/.blino/`）

```
~/.blino/
├── settings.json          # 全局配置（API key、模型等）
├── skills/                # 用户级 skill（所有项目共享）
│   └── git-commit.md
├── projects/              # 会话记录与 workflow 快照
│   └── <项目hash>/
│       ├── <sessionId>.jsonl          # 会话 transcript
│       └── workflow-run-<runId>.json  # workflow 执行快照
└── memory.json            # AI 跨会话记忆
```

### 项目目录（`<项目>/.blino/`）

```
<项目>/.blino/
├── settings.local.json    # 项目级配置（覆盖全局）
├── skills/                # 项目级 skill
│   └── code-review.md
├── workflows/             # Workflow 定义文件
│   ├── content-pipeline.json
│   ├── code-review.json
│   └── research-summary.json
├── tools/                 # 用户自定义工具
│   ├── my-api.json        # 声明式 HTTP 工具
│   └── format-date.tool.js  # 脚本式工具
└── artifacts/             # 保存的可视化产出
```

### Workflow 快照结构

```json
{
  "version": 1,
  "updatedAt": "2026-04-25T15:36:58Z",
  "workflowId": "content-pipeline",
  "runSessionId": "xxx",
  "projectRoot": "/path/to/project",
  "nodes": {
    "outline": {
      "status": "done",
      "result": "1. 章节一\n2. 章节二",
      "startedAt": "2026-04-25T15:36:15Z",
      "finishedAt": "2026-04-25T15:36:25Z"
    }
  }
}
```

节点状态值：`pending` / `running` / `done` / `failed`

---

## 附录：内置工具列表

| 工具名 | 说明 |
|---|---|
| `Bash` | 执行 shell 命令 |
| `FileRead` | 读取文件内容 |
| `FileEdit` | 编辑文件（行级精确修改） |
| `FileWrite` | 写入/创建文件 |
| `Glob` | 按模式匹配文件路径 |
| `Grep` | 在文件中搜索内容 |
| `NotebookEdit` | 编辑 Jupyter notebook |
| `WebFetch` | 获取网页内容 |
| `WebSearch` | 联网搜索 |
| `ImageRead` | 读取图片（base64） |
| `PDFRead` | 读取 PDF 内容 |
| `Skill` | 调用已定义的 skill |
| `SkillCreator` | 创建/更新/删除 skill 文件 |
| `AskUser` | 向用户提问（交互式） |
| `TodoWrite` | 管理任务列表 |
| `Agent` | 派生子 agent 执行子任务 |
| `ToolSearch` | 搜索可用工具 |
| `ListMcpResources` | 列出 MCP 资源 |
| `ReadMcpResource` | 读取 MCP 资源内容 |