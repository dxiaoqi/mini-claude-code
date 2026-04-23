---
name: skill-creator
description: 通过多轮小问或一页清单向用户收信息，再轻量落盘 workflow.json 与各 skill 包；不要求用户会写专业需求。
allowedTools: [FileRead, FileEdit, FileWrite, Glob, Grep, Bash, Skill, AskUser]
---

# Skill Creator — 脚手架 workflow + skill 包

## 目标

在**当前项目根**下落盘（用户不必懂 JSON / PRD 术语）：

1. **`.blino/workflow.json`** — 尽量**小**：`schemaVersion`、`profile`、**默认 2～4 个** `phases`、每阶段 1～2 个 `activateSkillPacks`；可选 `evaluation` / `team` 能省则省。
2. **`.blino/skills/<pack-name>/`** — 每包至少一个 `.md` skill，正文用**平实中文**，说明「这步帮用户做什么、随手填什么即可」。

**不要**在 `workflow.json` 里写长说明；**不要**默认生成七八个阶段或十几个 pack。宁可少而清晰。

**不要**在 workflow 里写长正文；正文体放在各 `.md` skill 中。

## 工作流（对代理）

### 0. 先收信息：多轮小问 或 一页小清单（二选一或组合，优先轻量）

用户往往写不出专业需求。**不要**要求对方一次性给出完整场景描述。

**做法 A — 多轮（每轮最多 2 个问题）**

- 第 1 轮：要拿这本书 / 做这件事**想解决什么问题**？（一句话）+ **谁会用到结果**？（自己 / 团队 / 客户，可选）
- 第 2 轮：**有没有截止时间或必须包含的章/主题**？没有就说「无」
- 第 3 轮（仅当要拆多领域时）：**最想拆成几块知识**？（**最多 4 块**，用户可以说「不知道」——由你根据上文拟 2～3 个 pack 名并**让用户用「行 / 要改第几行」确认**即可）

可用 **AskUser** 在需要时问一句；若用户已在一条消息里答完，**不要**重复追问。

**做法 B — 一页「像表单、不像文档」的清单（可直接贴在回复里让用户填空）**

用 Markdown 列短问题即可，**不要**做成正式表格。示例（按需删减）：

```text
1. 我打算用拆书/整理做什么？（一句话）
2. 有没有书名或材料来源？没有就写「无」
3. 最在意的三个结果？（可写 1～3 条，如：清单 / 时间线 / 待办 / 给老板的一页纸）
4. 希望分几步做完？（不知道就写「你帮我分」） 
```

用户填回后，把答案**浓缩成**：一句目标 + **默认 2～4 个阶段**的标题（`id` 用英文短词或拼音均可，**要好记**）+ 每阶段对应**几个技能包目录名**（`kebab-case`，无空白无斜杠）。

**默认约定（若用户说「你定」）**

- `phases`：**3 个**最常见：`collect`（收材料/章）→ `organize`（分领域整理）→ `use`（汇总到项目/需求/一页结论）。
- 每个 phase：`activateSkillPacks` 里 **1～2 个** pack 即可；**全文最多 6 个** pack 名，超出需向用户说明并征得同意。

只有在这几步都有答案（或用户明确「按默认来」）后，再进入读盘与落盘。若 `args` 里已经写清类似信息，**优先用 args**，**少问或不问**。

### 1. 读已有文件，避免误覆盖

- 用 `Glob` 找 `**/.blino/workflow.json` 或从项目根 `resolve` 的 `.blino/workflow.json`（若已存在，用 `FileRead` 读；**合并** `phases` 或按用户要求整文件替换，并在回复里说明）。

### 2. 写 `workflow.json`（最小合法示例）

需满足运行时的 Zod 校验（与仓库 `src/utils/workflow.ts` 一致）：

- `schemaVersion`：正整数，当前用 **1**。
- `profile`：非空字符串，描述场景。
- 可选 `phases`：每项必含 `id`；`notes` 用**半句中文**说给人看（不要写长段落）。`activateSkillPacks` 每项是 `skills` 下**一级子目录**名，例如 `["week1"]` 只加载 `.<blino>/skills/week1/**/*.md`。
- 可选 `evaluation` / `team`：新手场景**可省略**；只有用户明确要「自动验收」或「多角色说明」时再加。

**示例（轻量两阶段，按需增删改）**：

```json
{
  "schemaVersion": 1,
  "profile": "my-scenario",
  "phases": [
    {
      "id": "setup",
      "notes": "收材料、弄清目标",
      "activateSkillPacks": ["setup-pack"]
    },
    {
      "id": "build",
      "notes": "按领域整理、产出笔记",
      "activateSkillPacks": ["work-pack"]
    }
  ]
}
```

用 **FileWrite** 写入 **`<project>/.blino/workflow.json`**（`mkdir` 对 `.blino` 若需要，用 Bash: `mkdir -p .blino`）。JSON 要格式化（2 空格缩进）便于人类 diff。

### 3. 为每个 `activateSkillPacks` 里出现的 pack 建目录与占位 skill

对每个 pack 名 `P`：

- 确保存在目录：**`.blino/skills/P/`**（Bash: `mkdir -p .blino/skills/P`）
- 至少写一个 **`intro.md`（或同义文件名）**，包含 YAML frontmatter。正文面向**不专业的最终用户**：

  - 用**第二人称**（你…），一小节**「这步要做什么」**，一小节**「你随便填什么就行」**（可列 3～5 个填空提示），一小节**「怎么算做完」**（可勾选表述）。
  - 避免 PRD/敏捷术语；如必须用，**括号里一行白话**。

示例：

```markdown
---
name: setup-intro
description: 这步我们先把目标和材料理清楚
---
# 这步是干什么的

（一两句话）

## 你随便填

- 我想解决的问题：＿＿＿
- 有的材料：＿＿＿
- 没有也可以：＿＿＿

## 怎样算这步可以过

- [ ] 我能在一句话说清「要交付啥」
```

**命名**：`name` 在全局 skill 列表中**唯一**；多 pack 合并时**后者覆盖同名**——建议各 pack 内 name 用前缀，如 `setup-intro`、`work-intro`。

### 4. 收尾说明（对用户可见的简短段落）

- 用**人话**总结：我根据你刚才填的/答的，生成了**哪几个阶段**、**哪几个包**、接下来你在对话里**可以怎么说**来继续（不必背命令）。
- 新配置在**新会话**或**重启 Agent** 后随 `loadSettings` 生效；技能列表缓存时终端 **`/clear`** 可重载；多阶段时 **`/phase` / `/phase next` / `/phase prev`** 切换阶段与可见 skill。Web **「项目」**里可点阶段与刷新。
- 提醒把 **`.blino/workflow.json`** 中需要团队共享的内容**提交 git**；`settings.local.json` 通常不提交。

## 不要做的事

- 不要把整本教材或长篇计划写进 `workflow.json`；保持 JSON 小而可审阅。
- 不要**默认**要用户会写多阶段、多 pack、长描述；**先收信息再落盘**。
- 不要引入带 `..` 或带 `/` 的 pack 名（运行时会跳过非法段）。
- 不要假设用户已全局安装 `blino`；路径一律相对**项目根**。

## 若用户只想要「一个空壳」

写最小 `workflow.json`（`schemaVersion` + `profile: "default"`）+ 空目录 `.blino/skills/` 即可，并说明可再运行本 skill 或手改；或先发**一页小清单**让用户下次填。

## 获得本技能（内置，推荐）

- **CLI**（在仓库/项目根执行）：`blino init` — 会写入 **`.blino/skills/skill-creator.md`**（已存在时跳过，可用 `blino init --force` 覆盖）。  
- **Web UI**：打开「设置」→ 点击 **「安装 skill-creator」**（调用后端 `POST /api/init/skill-creator`）。

装好后在对话中执行 **Skill: `skill-creator`**（可带 `args` 描述场景），让模型按上文脚手架 `workflow.json` 与各 pack。

### 用户想轻量体验时，可以整段复制下面这段

> 执行 **skill-creator**。先**不要**急着写 `workflow.json`：用**一页手填小问**（或最多两轮、每轮一个问题）问清：我想拿这本书/材料**解决啥**、**给谁用**、**想要啥样成果**（清单/一页纸/待办都行）。我列不清专业需求，你帮定**默认 2～3 个阶段**和**几个技能包名**，我只需要说「行」或改一两个字。确认后再落盘到 `.blino/`，并用**人话**告诉我接下来怎么在「项目」里切换阶段。

若已非常清楚目标，可在同一条消息里直接写两三句，模型应**少问快落盘**。

手动复制（可选）：`node_modules/blino-agent/templates/blino-skills/skill-creator.md` 或包内同路径。
