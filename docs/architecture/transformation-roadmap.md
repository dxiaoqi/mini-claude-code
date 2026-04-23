# 项目识别与改造规划

> 分支基准：`cursor/blino-config-migration-2822`（自 `feat/ui-settings-sessions-visual-history` / `6afdfa0`）  
> 目标：在已统一 **Blino + `.blino`** 的前提下，收敛工程化细节，并为 **策略 / 流程 / 轻量评估** 预留可演进路径。

---

## 一、当前项目内容（识别摘要）

### 1.1 产品形态

| 部分 | 说明 |
|------|------|
| **npm 包** | `blino-agent`（`package.json`） |
| **CLI** | `bin/blino.js` → 全局命令 **`blino`**（`--tui`、`--serve`、REPL、Coordinator 等） |
| **后端** | `src/server/index.ts`：HTTP API（配置、会话、聊天、权限、**visual-context**、artifacts 等） |
| **前端** | `ui/`：Next 应用，经 `build:web` 产出到 `ui-standalone/`，`NEXT_PUBLIC_BLINO_URL` 等指向本地 Agent |
| **构建** | `tsc` + `scripts/postbuild.js` / `build-web.js`；`prepublishOnly` 走 `build:all` |

### 1.2 配置与数据目录

**已统一为 `.blino`**（用户目录 `~/.blino`，项目目录 `<cwd>/.blino`）：

- `settings.json` / `settings.local.json`：API、MCP、权限等（`src/utils/config.ts`、`src/mcp/config.ts`）
- `server.json`：TUI/服务锁（`src/utils/portManager.ts`）
- `projects/<hash>/`：transcript、dev trace（`transcript.ts`、`devTrace.ts`）
- `memory/<hash>/`：session memory（`sessionMemory.ts`）
- `snapshots/`、`overflow/`：快照与超大 tool 输出
- `skills/`：项目/用户 skill markdown（`context/skills.ts`）
- `artifacts/`：可视化块落盘（`src/server/index.ts`）

**实现方式**：`getBlinoDir()`（`src/utils/paths.ts`）集中根目录名。

**UI/文案**：`ApiSettingsPanel`、`VisualRenderer` 等已写 `.blino`；与后端一致。

### 1.3 与旧命名的关系

- 代码与文档中**未发现**仍使用 `.mini-claude` 或旧 CLI 名（本分支已迁完）。
- **`.gitignore`**：已忽略 `.blino/settings.local.json`。

### 1.4 已有架构文档

本分支在撰写本文件时 **无** `docs/architecture/` 下其他独立文档；若你曾在其他分支有 `layered-policy-workflow` 类文档，可 cherry-pick 或合并后与本路线图交叉引用。

---

## 二、改造规划（分阶段）

### P0 工程卫生 — **已实现**

| 项 | 内容 |
|----|------|
| **路径常量** | `src/utils/paths.ts`：`getBlinoDir()`（默认 `.blino`，可用 `BLINO_DIR_NAME` 覆写）；`WORKFLOW_FILE`。已替换各模块硬编码。 |
| **.gitignore** | `.blino/settings.local.json`（见仓库根目录）。 |

---

### P1 轻量「项目策略」文件 — **已实现**

| 项 | 内容 |
|----|------|
| **落盘** | `<project>/.blino/workflow.json`（常量 `WORKFLOW_FILE`）。 |
| **内容（v1）** | `schemaVersion`（正整数）、`profile`、`phases[]`、`evaluation[]`（`type`: `script` \| `file_exists`）、可选 `team`；Zod 校验。 |
| **合并** | `loadSettings(projectRoot)` 在合并三级 settings 后加载 workflow，成功则 `Settings.projectPolicy = ...`；失败时 `console.warn` 且不回写 policy。 |
| **HTTP 会话** | `getOrCreateSession` 使用 `loadSettings` 初始化 `SessionState.settings`（含 `projectPolicy`）。 |
| **CLI** | `createSessionState` 使用展开后的 `fileSettings`（含 `projectPolicy`）。 |

**单测**：`tests/unit/utils/workflow.test.ts`。

---

### P2 与 Skill / 工作流阶段 — **已实现**

| 项 | 内容 |
|----|------|
| **Pack 路径** | `phases[].activateSkillPacks` 为**单级目录名**（如 `"day1"` → 仅加载 `.<blino>/skills/day1/**/*.md`）；多 pack 合并后按 skill `name` 去重。Pack 模式下项目侧 **不混** 根目录 `skills/*.md`；**不加载** `~/.blino/skills`（避免与阶段混用）。 |
| **loadSkills** | 支持 `LoadSkillsOptions`：`includeUser`、`activateSkillPacks`。无 pack 时行为同前：根级 `.md` + 非递归（与旧版一致）。 |
| **SessionState** | `activePhaseIndex`、`activePhaseId`、`activeSkillPacks`；`createSessionState` / `clearSession` 内调 `applyWorkflowRuntimeToState`。 |
| **Runtime** | `src/utils/workflowRuntime.ts`：`applyWorkflowRuntimeToState`、`advanceWorkflowPhase`。 |
| **SkillTool** | 按 `sessionId` 缓存；读 `loadSkills(root, { activateSkillPacks, includeUser:false })` 当 `activeSkillPacks` 非空。 |
| **System prompt** | 有 `projectPolicy` 时注入 **Project workflow** 段（profile、当前阶段、限定的 pack）。 |
| **CLI** | `/phase`、`/phase next`、`/phase prev` 切换阶段并清空 prompt section cache + skill 缓存。 |

**单测**：`tests/unit/utils/workflowRuntime.test.ts`、`tests/unit/context/skills-packs.test.ts`。

---

### P3 多 Agent / Team（长期）

- 在 **Coordinator 已有** 能力上扩展；声明式 `team` 段（若需要）与 `coordinator` 实现放在后续迭代，本路线图不展开实现细节。

---

## 三、风险与不做的事

- **不**在首轮引入重量级工作流引擎；JSON 仅策略与引用。
- **不**在 P0 修改 npm 包名或仓库 URL（已稳定为 `blino-agent` / blino 仓库）。
- 若从其他 Git 分支合并文档或代码，先解决与 **`feat/ui-settings-sessions-visual-history` 线** 上 UI/服务端差异（例如被删除的 `ConfigModal` 等），再 cherry-pick。

---

## 四、建议执行顺序

1. **P0–P1**：已合入。  
2. **P2**：已合入（本段）。  
3. **P3**：按产品优先级排期。

**内置 skill-creator**：`blino init`、HTTP `POST /api/init/skill-creator`、Web 设置中「安装 skill-creator」— 将模板写入 `.<blino>/skills/skill-creator.md`（`src/utils/installSkillCreator.ts`）。

---

*文档可随实现更新； major 行为变更时同步更新本节「当前项目内容」。*
