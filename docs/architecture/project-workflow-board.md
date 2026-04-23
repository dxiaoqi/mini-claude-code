# 项目工作流看板（Workflow / Kanban）— 设计与实现规划

> **目标**：在对话旁提供**实时、低认知负担**的设计流与状态可视区，与现有 `workflow.json` 阶段、Skill pack、会话状态对齐；**默认不增加 LLM 上下文 token**（见下文「上下文原则」）。

---

## 一、问题与原则

| 原则 | 说明 |
|------|------|
| **UI 为真** | 看板/泳道上的状态以 **HTTP API + 本地 JSON** 为准，不依赖模型每轮 narrate。 |
| **少 token** | 不把整块看板 JSON 写入 `system`；不自动把看板长文注入对话。可选：用户点「让 AI 根据当前看板给建议」再显式把**裁剪后的摘要**发给模型。 |
| **与 workflow 一阶** | 第一版以 **`workflow.json` 的 `phases` 为水平泳道或步骤条**；卡片为可选层（见阶段划分）。 |
| **实时** | 轮询短间隔或在未来加 SSE；MVP 用 **2～5s 轮询** + 焦点/打开面板时 `refetch` 即可。 |
| **可恢复** | 看板数据落盘在 `.blino/`，git 可提交团队共享；与 `server.json` 锁、会话无强绑定（也可记录 `lastTouchedSessionId` 作审计，可选）。 |

---

## 二、信息架构

### 2.0 Mermaid 流程图（可选）

- 在 **`.blino/workflow.json`** 根级可增加可选字段 **`mermaid`**（字符串）：合法 **Mermaid** 源码，由 **「项目」侧栏** 内 `ProjectWorkflowSection` 渲染（`mermaid` npm 包，`securityLevel: 'strict'`）。
- **未写 `mermaid`** 时，UI 根据 **`phases`** 自动生成简易 **`flowchart LR`**（`P0 -> P1 -> ...`），当前阶段在标签前加 **`▶`** 以便区分。
- 该字符串**不**注入 LLM `system` prompt；仅影响浏览器展示。

### 2.1 已有数据源（只读即可驱动「设计流」视图）

| 数据 | 来源 | 用途 |
|------|------|------|
| 工作流策略 | `GET /api/workflow` → `projectPolicy` | 阶段列表、`profile`、每阶段 `notes`、`activateSkillPacks` |
| 当前阶段 | `GET /api/sessions/:id` 中的 `workflow` 段（或轮询体） | 高亮「当前步」、与 `ProjectSettingsPanel` 一致 |
| 工作区 | `GET /api/workspace` | 标题/脚注展示 `cwd` |
| 技能 | `GET /api/skills` | 看板副栏：本阶段相关 pack 下有哪些 skill 名（可选，需 session 的 `activeSkillPacks`） |

以上已足够做 **MVP：横向阶段条 + 当前阶段高亮 + 点选切换阶段（已有 POST phase）**。

### 2.2 新增持久化：`.blino/board.json`（第二阶，可选卡片）

在需要「列 / 卡片」时引入**单文件、小 schema**，避免与 `workflow.json` 争义：

```json
{
  "schemaVersion": 1,
  "columns": [
    { "id": "backlog", "label": "待办" },
    { "id": "doing", "label": "进行中" },
    { "id": "done", "label": "完成" }
  ],
  "items": [
    {
      "id": "uuid",
      "title": "短标题",
      "columnId": "doing",
      "phaseId": "build",
      "detail": "可选说明",
      "updatedAt": "ISO8601"
    }
  ]
}
```

- **默认**：无文件或 `items: []` 时，UI 只显示**阶段流**，不显示空看板列，避免干扰。
- **phaseId** 可选：与 `workflow.json` 的 `phases[].id` 对应，用于按阶段筛卡片或着色。
- **写入**：`PUT /api/board` 或 `PATCH` 增量；服务端校验路径在 `getBlinoDir()` 下、Zod 校验、与 `workflow` 的 `phases` id 可交叉校验（警告非法 id，不崩）。

---

## 三、UI/UX 设计

### 3.1 布局（当前 P1）

- **主聊天区不展示**工作流/泳道/Mermaid，避免与对话抢注意力。
- **「项目」侧栏**加宽（约 560px），内 **`ProjectWorkflowSection`**：profile、阶段标签、**← / →**、当前说明、**Mermaid 图**（`max-height` + 区内容器滚动，防大图撑破布局）。
- **P2+**：可选在侧栏下再叠 Kanban 或全屏 `BoardDrawer`（未做）。

### 3.2 与「项目」侧栏关系

- 工作流、流图、阶段切换**全部**在侧栏，与技能列表、重载、Skill 装在同一面板内上下滚动；无顶栏工作流条。

### 3.3 无 session 时

- 无 `sessionId` 时：阶段条**只读展示** `workflow` + 默认 `activePhaseIndex:0` 或来自磁盘的 `board`；切换阶段与「点下一步」**禁用**并 tooltip「先发一条消息建立会话」。

---

## 四、API 设计（增量）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/workflow` | 已有 |
| `GET` | `/api/sessions/:id` | 已有，含 `workflow` |
| `POST` | `/api/sessions/:id/workflow/phase` | 已有 |
| `GET` | `/api/board` | 读 `.blino/board.json`；无文件返回 `{ ok: true, board: null }` |
| `PUT` | `/api/board` | 写完整 board（小文件） |
| 可选 | `GET /api/sessions/:id/snapshot` | 未来：单 endpoint 聚合一帧（workflow + board + skills），减少前端并发 |

**鉴权/范围**：与现有 API 相同，**仅**操作 `config.cwd` 下 `.blino`，不跨工作区。

---

## 五、前端模块

| 模块 | 职责 |
|------|------|
| `ProjectWorkflowSection.tsx` | **项目**侧栏内：profile、阶段标签、上一/下一阶段、Mermaid 图区（可滚动）；轮询 |
| `ProjectSettingsPanel.tsx` | 加宽侧栏壳、工作区、内嵌 `ProjectWorkflowSection`、技能列表等 |
| `BoardDrawer.tsx`（P2） | 可选：Kanban |
| `boardApi.ts` | `fetch` 封装、类型与 `board.json` 对齐 |
| `page.tsx` | 打开「项目」时展示侧栏；主聊天区**不**挂工作流条 |

**状态源**：`activeSessionId` 已有；轮询时若 `!activeSessionId` 仅 `GET /api/workflow` + 可选 `GET /api/board`。

---

## 六、与 LLM 上下文的边界（再确认）

- **不**将 `board.json` 全量或整段看板加入 `buildSystemPrompt`。
- 若以后需要「AI 读看板」：在 **user 消息** 或 **单独 tool** 中注入**用户点选后的摘要**（例如最多 1～2K 字符），而不是默认注入。

---

## 七、实现阶段（可交付粒）

### P1 — 工作流区（MVP）— **已实现（主对话不展示流）**

- [x] 后端：`GET /api/sessions/:id/workflow` — 仅返回 `workflow` 摘要 + `phases` 元数据（**无 messages**），供轮询。
- [x] 前端：`ProjectWorkflowSection` 在 **「项目」侧栏**（约 `min(560px, 100vw)`），含 Mermaid；图形容器 `max-height: min(50vh, 480px)` + **overflow:auto**；**已移除** 主界面 `WorkflowBar`。
- [x] 数据：面板打开时约 4s 轮询 `GET /api/workflow` + 有 session 时 `GET /api/sessions/:id/workflow`。
- [x] 操作：有 session 且多阶段时 `POST .../workflow/phase`；无 `workflow.json` 时侧栏内提示。
- [ ] 验收：**无** LLM 上下文变化（纯 UI + 轻量 API）。

### P2 — `.blino/board.json` + 读写 API + 轻看板

- [ ] `src/utils/board.ts`：Zod schema、`readBoard` / `writeBoard`、默认空。
- [ ] `GET/PUT /api/board` 在 `server/index.ts` 注册。
- [ ] `BoardDrawer`：三列 + 增删改卡片；本地乐观更新 + `PUT` 落盘；可选 `phaseId` 筛选。
- [ ] 单元测试：schema 与文件读写（临时目录）。

### P3 — 体验与集成（可选）

- [ ] 拖拽排序（`columnId` / `order` 字段）；键盘可达性。
- [ ] `GET /api/sessions/:id/snapshot` 减少请求次数。
- [ ] 与 **TodoWrite** 不对接（避免双源）；若需对接，需单独设计「从 todo 同步到 board」的明确规则，避免 scope 膨胀。

### P4 — 未来

- [ ] SSE：`/api/sessions/:id/events` 推送 `phaseChanged` / `boardUpdated`（多标签页同步）。
- [ ] 与 **多 agent** 仅**声明**关系：`board.items[].owner` 或 `tags`，不实现调度。

---

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| 轮询略增后端 QPS | 可折叠时暂停轮询；仅面板展开时快轮询 |
| `board` 与 `workflow` 阶段 id 不一致 | PUT 时校验/剥离非法 `phaseId`；UI 标灰 |
| 多标签页同写 | MVP 可接受 last-write-wins；P4 用版本号或 ETag |

---

## 九、与现有文档关系

- 本文件是 **项目工作流/看板** 的专项设计；**不替代** `workflow.json` 的 schema 定义（以 `src/utils/workflow.ts` 为准）。
- 完成后可在 `transformation-roadmap.md` 增加一节链接至本文，并标 P1/P2 完成状态。
