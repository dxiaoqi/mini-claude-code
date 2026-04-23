---
name: skill-creator
description: Create or extend the Blino workflow (workflow.json) and skill pack folders under .blino/skills/ from the user's scenario (e.g. training, checklist, multi-phase work).
allowedTools: [FileRead, FileEdit, FileWrite, Glob, Grep, Bash, Skill]
---

# Skill Creator — 脚手架 workflow + skill 包

## 目标

按用户说的场景（职业培训、多阶段任务、多 profile 等），在**当前项目根**下落盘：

1. **`.blino/workflow.json`** — 轻量声明：schema、profile、phases、可选 `activateSkillPacks` / `evaluation`。
2. **`.blino/skills/<pack-name>/`** — 每个 pack 一个目录，内放本阶段的 `.md` skill（可多层子目录；加载时会**递归**读 `.md`）。

**不要**在 workflow 里写长正文；正文体放在各 `.md` skill 中。

## 工作流（对代理）

### 0. 先弄清需求（若用户没写清，先问 1～2 个闭环问题）

- 场景名 / profile 名？（如 `onboarding-bootcamp`）
- 分几个阶段、每阶段**一句**目标？
- 每阶段要暴露哪些「技能包 id」？（**单一目录名、无斜杠**，如 `week1`、`api-lab`）

### 1. 读已有文件，避免误覆盖

- 用 `Glob` 找 `**/.blino/workflow.json` 或从项目根 `resolve` 的 `.blino/workflow.json`（若已存在，用 `FileRead` 读；**合并** `phases` 或按用户要求整文件替换，并在回复里说明）。

### 2. 写 `workflow.json`（最小合法示例）

需满足运行时的 Zod 校验（与仓库 `src/utils/workflow.ts` 一致）：

- `schemaVersion`：正整数，当前用 **1**。
- `profile`：非空字符串，描述场景。
- 可选 `phases`：每项必含 `id`；可选 `notes`、`activateSkillPacks`（**字符串数组**，每个是 `skills` 下**一级子目录**名，例如 `["week1"]` 只加载 `.<blino>/skills/week1/**/*.md`）。
- 可选 `evaluation`：每项有 `id`、`type`（`script` | `file_exists`）、`spec`（对象）。
- 可选 `team`：仅声明式，一般首轮可省略。

**示例（按需改 profile / 阶段 / pack 名）**：

```json
{
  "schemaVersion": 1,
  "profile": "my-scenario",
  "phases": [
    {
      "id": "setup",
      "notes": "环境与约定",
      "activateSkillPacks": ["setup-pack"]
    },
    {
      "id": "build",
      "notes": "实现功能",
      "activateSkillPacks": ["build-pack"]
    }
  ]
}
```

用 **FileWrite** 写入 **`<project>/.blino/workflow.json`**（`mkdir` 对 `.blino` 若需要，用 Bash: `mkdir -p .blino`）。JSON 要格式化（2 空格缩进）便于人类 diff。

### 3. 为每个 `activateSkillPacks` 里出现的 pack 建目录与占位 skill

对每个 pack 名 `P`：

- 确保存在目录：**`.blino/skills/P/`**（Bash: `mkdir -p .blino/skills/P`）
- 至少写一个 **`intro.md`**，包含 YAML frontmatter，例如：

```markdown
---
name: setup-intro
description: What to do in this pack (one line)
---
# 本阶段

（写清用户/学员在本阶段要做什么、如何验收、禁止事项。可引用仓库路径。）
```

**命名**：`name` 在全局 skill 列表中**唯一**；多 pack 合并时**后者覆盖同名**——建议各 pack 内 name 用前缀，如 `setup-intro`、`build-intro`。

### 4. 收尾说明（对用户可见的简短段落）

- 新配置在**新会话**或**重启 Agent** 后随 `loadSettings` 生效；技能列表缓存时终端 **`/clear`** 可重载；多阶段时 **`/phase` / `/phase next` / `/phase prev`** 切换阶段与可见 skill。
- 提醒把 **`.blino/workflow.json`** 中需要团队共享的内容**提交 git**；`settings.local.json` 通常不提交。

## 不要做的事

- 不要把整份教纲写进 `workflow.json`；保持 JSON 小而可审阅。
- 不要引入带 `..` 或带 `/` 的 pack 名（运行时会跳过非法段）。
- 不要假设用户已全局安装 `blino`；路径一律相对**项目根**。

## 若用户只想要「一个空壳」

写最小 `workflow.json`（`schemaVersion` + `profile: "default"`）+ 空目录 `.blino/skills/` 即可，并说明可再运行本 skill 或手改。

## 获得本技能（内置，推荐）

- **CLI**（在仓库/项目根执行）：`blino init` — 会写入 **`.blino/skills/skill-creator.md`**（已存在时跳过，可用 `blino init --force` 覆盖）。  
- **Web UI**：打开「设置」→ 点击 **「安装 skill-creator」**（调用后端 `POST /api/init/skill-creator`）。

装好后在对话中执行 **Skill: `skill-creator`**（可带 `args` 描述场景），让模型按上文脚手架 `workflow.json` 与各 pack。

手动复制（可选）：`node_modules/blino-agent/templates/blino-skills/skill-creator.md` 或包内同路径。
