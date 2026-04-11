# 08 — MCP 与 Skill 系统（Phase 1D）

## MCP：让 AI 连接外部工具服务器

MCP（Model Context Protocol）是 Anthropic 提出的工具服务器协议。通过 MCP，AI 可以连接数据库、搜索引擎、文件系统等外部服务。

### 架构

```
.mini-claude/settings.json
  → loadMCPConfigs()        — 三级配置合并
  → MCPClientManager
    → connect(config)       — stdio 或 HTTP 传输
    → listTools()           — 发现远端工具
  → adaptMCPTools()         — 包装为 Tool 接口
  → tools 数组              — 与内置工具一起注册
```

### 配置示例

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "test.db"]
    },
    "remote-api": {
      "transport": "http",
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

### 工具适配的核心问题

MCP 工具的 schema 是 JSON Schema，我们的内部 Tool 接口用 Zod。需要转换：

```typescript
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  // JSON Schema → Zod 对象
  switch (schema.type) {
    case 'string': return z.string()
    case 'number': return z.number()
    case 'object': return z.object(convertProperties(schema.properties))
    ...
  }
}
```

### 工具命名空间

MCP 工具名加上 `mcp__<server>__` 前缀避免冲突：

```
mcp__sqlite__query        — sqlite 服务器的 query 工具
mcp__sqlite__list_tables  — sqlite 服务器的 list_tables 工具
```

### 三级配置合并

```
~/.mini-claude/settings.json          — 用户级（全局）
.mini-claude/settings.json            — 项目级（提交到 git）
.mini-claude/settings.local.json      — 本地级（不提交）
```

后读覆盖先读。支持 `${VAR}` 环境变量展开。

## Skill：AI 的"子程序"

Skill 是带结构化元数据的 Markdown prompt 文件，定义了可复用的工作流。

### 文件结构

```
.mini-claude/skills/
├── commit.md       — git commit 工作流
├── review.md       — 代码 review 工作流
└── deploy.md       — 部署工作流
```

### Skill 文件格式

```markdown
---
name: commit
description: 生成 commit 信息并提交
allowedTools: [Bash]
---

分析 `git diff --cached` 的变更内容，生成符合 Conventional Commits 规范的提交信息。

步骤：
1. 执行 `git diff --cached --stat` 查看变更文件
2. 执行 `git diff --cached` 查看详细变更
3. 基于变更生成 commit message
4. 执行 `git commit -m "生成的消息"`
```

### 解析逻辑

```typescript
// YAML frontmatter 解析
const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
const frontmatter = match[1]  // name, description, allowedTools
const prompt = match[2]       // 工作流 prompt
```

### SkillTool 的调用流程

```
用户: "帮我提交代码"
  ↓
AI 决定: SkillTool({ skill: "commit" })
  ↓
SkillTool.call():
  1. loadSkills() — 从 .mini-claude/skills/ 加载
  2. 找到 "commit" skill
  3. 返回 skill.prompt 作为 tool_result
  ↓
AI 收到 prompt，按工作流执行（用 Bash 跑 git 命令）
```

### "list" 特殊调用

```
SkillTool({ skill: "list" })
→ 返回所有可用 skill 的名称和描述
```

### 缓存

Skill 列表在首次调用时加载并缓存，`/clear` 时失效。修改 `.mini-claude/skills/` 下的文件后，`/clear` 可刷新。
