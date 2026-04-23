# Blino

一个轻量级 AI 编程助手，内置 Web UI，支持多 Provider、工具调用、MCP 集成与上下文压缩，并可生成可交互的可视化图表（架构图、数据看板等）。

---

## 环境要求

- **Node.js ≥ 20**（推荐 22.x）
- npm 或 pnpm

---

## 安装

### 方式一：npm 全局安装（推荐）

```bash
npm install -g blino-agent
```

安装完成后直接使用：

```bash
blino --tui     # 启动 Web UI
blino           # 终端交互模式
```

### 方式二：从源码安装（开发 / 贡献）

```bash
# 1. 克隆并安装依赖
git clone https://github.com/dxiaoqi/blino
cd blino
npm install

# 2. 安装 Web UI 依赖
cd ui && npm install && cd ..

# 3. 全局注册 CLI
npm run link-global   # 之后可直接使用 blino 命令
```

---

## 配置 API

在 `~/.blino/settings.json` 中填写 API 信息（首次使用时创建此文件）：

```json
{
  "api": {
    "provider": "openai",
    "openaiApiKey": "sk-xxx",
    "openaiBaseUrl": "https://api.example.com/v1",
    "model": "claude-sonnet-4-20250514"
  }
}
```

也可以通过环境变量：

```bash
# Anthropic 官方
ANTHROPIC_API_KEY=sk-xxx

# OpenAI 兼容（第三方中转、本地 Ollama 等）
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.example.com/v1
```

**settings.json 全量字段：**


| 字段                     | 说明                                 | 示例                           |
| ---------------------- | ---------------------------------- | ---------------------------- |
| `api.provider`         | 提供商：`anthropic` / `openai`         | `"openai"`                   |
| `api.anthropicApiKey`  | Anthropic API Key                  | `"sk-ant-..."`               |
| `api.anthropicBaseUrl` | Anthropic Base URL（可选）             | `"https://..."`              |
| `api.openaiApiKey`     | OpenAI 兼容 API Key                  | `"sk-..."`                   |
| `api.openaiBaseUrl`    | OpenAI 兼容 Base URL                 | `"https://.../v1"`           |
| `api.model`            | 默认模型                               | `"claude-sonnet-4-20250514"` |
| `api.fallbackModel`    | 降级模型                               | `"claude-haiku-3"`           |
| `permissionMode`       | 权限模式：`default` / `auto` / `bypass` | `"default"`                  |
| `devTrace`             | 开启调试 trace 输出                      | `true`                       |
| `mcpServers`           | MCP 服务器配置（见下方）                     | `{...}`                      |


**项目策略（可选）**：在项目根创建 `.blino/workflow.json`，与 `settings` 一并加载并校验。用于声明 `profile`、多阶段 `phases`（每阶段可写 `activateSkillPacks` 限定只从 `.blino/skills/<pack名>/` 下加载 Skill）、轻量 `evaluation` 等（见 `docs/architecture/transformation-roadmap.md`）。字段包含 `schemaVersion`（正整数）。若文件无效，会在控制台警告并忽略策略。终端下可用 `/phase` / `/phase next` / `/phase prev` 在阶段间切换（会刷新可见 Skill 列表）。

**环境变量**：`BLINO_DIR_NAME` 可覆写数据目录名（默认 `.blino`，一般仅测试使用）。

---

## 启动方式

### 方式一：Web UI 模式（推荐）

同时启动后端（port 3001）和前端 UI（port 3000），浏览器自动打开：

```bash
# 全局安装后
nvm use 22 && blino --tui

# 或通过 npm script
npm run dev:web
```

启动成功后访问 `http://localhost:3000`。

### 方式二：终端交互模式（REPL）

```bash
# 使用 settings.json 中的配置
blino

# 临时覆盖配置
blino --api-key sk-xxx --model claude-sonnet-4-20250514

# 指定工作目录
blino --cwd /path/to/project
```

### 方式三：管道模式（非交互批处理）

```bash
# 从 stdin 读取，自动批准所有工具调用
echo "帮我列出当前目录所有 TS 文件" | blino -p

# 结合脚本使用
cat task.txt | blino -p --bypass-permissions
```

### 方式四：HTTP Server 模式

仅启动后端 API，不打开浏览器：

```bash
blino --serve --port 3001
```

---

## CLI 参数

```
blino [options] [prompt]
```


| 参数                     | 说明                                  |
| ---------------------- | ----------------------------------- |
| `[prompt]`             | 初始提示词（可选，省略则进入 REPL）                |
| `--api-key <key>`      | API Key                             |
| `--base-url <url>`     | API Base URL                        |
| `--model <model>`      | 模型名称                                |
| `--provider <type>`    | API Provider：`anthropic` 或 `openai` |
| `-p, --pipe`           | 管道模式：从 stdin 读取，自动批准工具              |
| `--bypass-permissions` | 自动批准所有工具调用                          |
| `--coordinator`        | Coordinator 多 Agent 模式              |
| `--resume [id]`        | 恢复历史 session（省略 id 则选择最近一个）         |
| `--serve`              | 仅启动 HTTP Server（port 3001）          |
| `--tui`                | 启动 HTTP Server + Web UI，并打开浏览器      |
| `--port <port>`        | HTTP Server 端口（默认 3001）             |
| `--host <host>`        | HTTP Server 监听地址（默认 localhost）      |


---

## REPL 命令

在交互模式中输入以 `/` 开头的命令：


| 命令              | 说明                       |
| --------------- | ------------------------ |
| `/exit`         | 退出                       |
| `/clear`        | 清空会话（重置消息、token、权限规则、快照） |
| `/compact`      | 手动触发上下文压缩（调用 LLM 生成摘要）   |
| `/status`       | 查看当前 token 数、成本、消息数      |
| `/model <name>` | 切换模型                     |
| `/undo [file]`  | 回滚文件修改（省略参数列出可回滚文件）      |
| `/resume`       | 恢复历史 session             |


---

## Web UI 使用说明

### 模式切换

输入框左侧有一个模式切换按钮：

- **Agent 模式**（默认）：直连 blino 后端，支持完整工具调用（bash / 文件读写 / 搜索 / MCP 等），适合代码辅助、项目分析、任务执行
- **Artifacts 模式**：Agent 模式 + 可视化渲染，在 Agent 工具调用能力的基础上，额外支持将 `<visual type="svg">` / `<visual type="html">` 输出渲染为交互图表；适合生成架构图、数据可视化、交互组件

### 工具调用面板

生成过程中，工具调用会显示在消息顶部的折叠面板内：

- 运行时：走马灯滚动显示当前工具名
- 完成后：自动折叠，显示调用摘要（`N 个工具调用 · bash · glob · ...`）
- 点击可展开查看每个工具的输入/输出详情

### 保存可视化内容

Artifacts 模式生成的 SVG/HTML 图表右上角有"保存"按钮，点击后自动保存到：

```
<工作目录>/.blino/artifacts/<timestamp>-<title>.[svg|html]
```

### 权限弹窗

Agent 执行高风险操作时（如删除文件、执行 shell 脚本），会弹出权限确认对话框：

- **允许一次**：本次操作通过，下次仍会询问
- **始终允许**：将该工具的该类操作加入白名单
- **拒绝**：阻止此次操作

---

## 工具清单

### 核心工具（始终加载）


| 工具             | 说明                            |
| -------------- | ----------------------------- |
| **Bash**       | Shell 命令执行（含 4 级危险分类）         |
| **FileRead**   | 读取文件（支持行范围）                   |
| **FileEdit**   | 精确字符串替换编辑                     |
| **FileWrite**  | 创建/覆盖文件                       |
| **Glob**       | 文件名模式搜索                       |
| **Grep**       | 文件内容正则搜索（rg 优先，grep fallback） |
| **TodoWrite**  | 任务列表管理                        |
| **AskUser**    | 向用户提问等待回答                     |
| **Skill**      | 执行自定义 Skill 工作流               |
| **Agent**      | 派生子 Agent 独立执行任务              |
| **ToolSearch** | 发现 deferred 工具                |


### Deferred 工具（通过 ToolSearch 按需加载）


| 工具                   | 说明                        |
| -------------------- | ------------------------- |
| **WebFetch**         | 网页抓取 + HTML→Markdown 转换   |
| **WebSearch**        | 网络搜索（需配置 Tavily API Key）  |
| **NotebookEdit**     | Jupyter Notebook 编辑       |
| **ImageRead**        | 图片读取（base64 → Vision API） |
| **PDFRead**          | PDF 文本提取                  |
| **ListMcpResources** | 列出 MCP 资源                 |
| **ReadMcpResource**  | 读取 MCP 资源                 |


---

## 权限模式

通过 `--permission-mode` 或 `settings.json` 中的 `permissionMode` 设置：


| 模式        | 说明                |
| --------- | ----------------- |
| `default` | 高风险操作弹窗确认，低风险自动通过 |
| `auto`    | 对话型任务自动通过大部分操作    |
| `plan`    | 先制定计划，执行前批量确认     |
| `bypass`  | 跳过所有权限检查（自动化场景）   |


---

## MCP 配置

在 `~/.blino/settings.json` 或项目的 `.blino/settings.json` 中配置 MCP 服务器：

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "mydb.sqlite"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "remote": {
      "transport": "http",
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

配置后重启，MCP 工具自动加载并可在对话中使用。

---

## Skill 系统

在 `.blino/skills/` 下创建 Markdown 文件来定义可复用的工作流。

**脚手架「Skill Creator」**（内置）：

- 在项目根执行 **`blino init`**，会在 **`.blino/skills/skill-creator.md`** 落盘内置模板（已存在则跳过，加 **`--force`** 覆盖）。  
- 使用 **Web UI** 时，打开 **设置** → **安装 skill-creator**（与上面等价）。  

然后在对话中执行 **Skill `skill-creator`**，让模型按引导创建或扩展 **`.blino/workflow.json`** 与各 **`.blino/skills/<pack>/`**。模板见 `templates/blino-skills/skill-creator.md`（亦随 npm 包发布）。

**Web UI**：顶栏 **「项目」** 侧栏可查看工作区路径、workflow 阶段（轻量左右箭头切换）、`.blino/skills` 文件列表、**重载与刷新**、安装 skill-creator，以及 **创建 Skill** 多轮向导（需已建立对话会话）。**`--tui`** 会自动生成与 UI 同端口匹配的 CORS 允许列表（含 `localhost` / `127.0.0.1` 成对、以及 `0.0.0.0` 时的局域网 IP）。部署到公网或反代时，在服务器上把 **`BLINO_PUBLIC_API_URL`** 设为浏览器可访问的 API 地址（如 `https://api.example.com`），必要时用 **`--cors-origin`** 或 **`BLINO_CORS_EXTRA`** 追加前端的 `Origin`。**`--serve`** 仍建议显式传 `--cors-origin` 或 `CORS_ORIGIN`，除非你知道默认行为。

### 手写 skill 示例

在 `.blino/skills/` 下创建 Markdown 文件来定义可复用的工作流：

```markdown
---
name: commit
description: 分析 staged 改动，生成规范的 commit 信息并提交
allowedTools: [Bash]
---

分析 `git diff --cached` 的内容，生成 Conventional Commits 格式的提交信息
（type(scope): subject），然后执行 `git commit -m "..."` 提交。
```

使用方式：在对话中说"帮我提交代码"，AI 会自动匹配并调用对应的 Skill。

---

## Coordinator 模式

将 AI 变为多 Agent 任务协调者，适合需要并行子任务的复杂工作流：

```bash
blino --coordinator
```

典型工作流：`Research（并行）→ Synthesis → Implementation（并行）→ Verification`

---

## 项目结构

```
/blino/
├── src/                    # 后端核心（Node.js）
│   ├── cli.ts              # CLI 入口
│   ├── types.ts            # 核心类型（含 UIEvent 统一事件协议）
│   ├── engine/             # Agent 循环、工具执行器
│   ├── api/                # Anthropic / OpenAI 客户端
│   ├── tools/              # 工具实现
│   ├── server/             # HTTP Server（REST + SSE）
│   ├── adapters/           # Terminal / Pipe / HTTP 适配器
│   ├── permissions/        # 权限引擎
│   ├── compact/            # 上下文压缩管线
│   ├── context/            # 系统提示 + Context Providers
│   └── mcp/                # MCP 协议支持
├── ui/                     # Web UI（Next.js）
│   ├── src/app/            # 页面 + API 路由
│   ├── src/components/     # 组件（ToolCallCard、PermissionDialog 等）
│   ├── src/lib/            # 工具库（visual renderer、orchestrator 等）
│   └── skill-pack/         # Artifacts 模式的 visual 协议规范
├── bin/blino.js      # CLI 入口脚本
└── package.json
```

---

## 常见问题

**Q: 启动时报 `API key is required`**  
A: 在 `~/.blino/settings.json` 中配置 `api.anthropicApiKey` 或 `api.openaiApiKey`，或设置对应环境变量。

**Q: Web UI 启动后浏览器打开空白页**  
A: Next.js 冷启动需要约 5 秒编译，稍等片刻后刷新页面。

**Q: `blino` 命令找不到**  
A: 需要先运行 `npm run link-global`，且确保使用 Node.js 20+（`nvm use 22`）。

**Q: Artifacts 模式生成的图表没有显示**  
A: 确保已切换到 Artifacts 模式（输入框左侧按钮显示 `⬡ Artifacts`，紫色）。首次使用 Artifacts 模式时会在后台预加载 visual 协议，切换后稍等 1-2 秒再发消息效果最佳。

**Q: 如何保存对话记录**  
A: 每次对话的 transcript 自动保存在 `~/.blino/projects/<hash>/` 目录下，使用 `blino --resume` 可以恢复历史会话。