# 分层调整方案：项目策略 / 流程 / 评估（轻量可配）

> 目标：在**不一次做重**的前提下，让「策略、流程、轻量评估」可落在项目级配置中；Agent 服务坚持负责**上下文、主循环、工具调用、MCP、可靠性**等工程层。

**状态**：规划；实现跟踪在本分支 `cursor/layered-policy-workflow-2822`。

---

## 一、当前基线（main）

| 区域 | 现状 |
|------|------|
| 用户/项目配置 | 目标为 **`~/.blino/settings.json`、`<project>/.blino/settings.json`、`<project>/.blino/settings.local.json`**（见 [`blino-directory-layout.md`](./blino-directory-layout.md)）；当前实现仍为 `.mini-claude` 直至迁移落地；合并逻辑见 `src/utils/config.ts` |
| 类型 | `Settings` 等集中在 `src/types.ts` |
| 技能 | `src/context/skills.ts`、`SkillTool`；`ui/skill-pack` 为前端包 |
| 多角色 | 已有 `coordinator` 相关模块（`src/engine/coordinator/`） |
| 循环与工具 | `AgentEngine` / `agentLoop`、权限引擎 |

**目录与配置根**：**只认 `.blino`** 作为项目/用户配置树（详见 [`blino-directory-layout.md`](./blino-directory-layout.md)）。**策略/流程** 单独文件，建议 **`<project>/.blino/workflow.json`**，不塞入巨型 `settings.json`；合并结果在进程内 `ResolvedConfig` 中完成。旧路径 **`.mini-claude` 的迁移/双读** 在实现中按该文档处理，非本文件重复定义。

---

## 二、目标分层

```
┌─────────────────────────────────────────────────────────┐
│  Project policy（可配置、版本化、可随 repo 提交）          │
│  策略 profile · 轻量阶段/流程 · 评估门槛 · 资源引用        │
│  建议落点: <project>/.blino/workflow.json                    │
└──────────────────────┬──────────────────────────────────┘
                       │ 加载、校验（Zod/JSON Schema）、版本号
┌──────────────────────▼──────────────────────────────────┐
│  Runtime orchestration（Agent 服务内，代码）              │
│  单/多 loop 调度 · handoff · 与 Settings 合并 · 打日志   │
└──────────────────────┬──────────────────────────────────┘
┌──────────────────────▼──────────────────────────────────┐
│  Mechanism（核心工程能力，基本不因场景分支）                │
│  上下文 · agent loop · 工具与 MCP · 流式 · 重试 · 安全    │
└─────────────────────────────────────────────────────────┘
```

**原则**：

- **mechanism** 不放业务规则硬编码；通过「解析后的 policy + Settings」驱动。
- **policy** 不承载复杂可执行逻辑；脚本类评估仅保留 **入口声明**（如 `command`），由运行时执行并解析结果。

---

## 三、建议的配置形态（v1 最小集）

与实现无关的**逻辑字段**，后续可收紧名字：

1. **`schemaVersion`**：整数，如 `1`。
2. **`profile`**：字符串 ID，如 `default` | `training` | `team-dev`（可扩展）。
3. **`phases`（可选）**：有序阶段列表，每项含 `id`、可选 `activateSkillPacks[]`、`notes`、可选 `toolAllowlist` 与现有权限模型对齐方式待定。
4. **`evaluation`（可选）**：轻量门槛列表，如 `{ "id", "type": "script"|"file_exists", "spec": { ... } }`；**是否通过**由运行时结合退出码/输出判断。
5. **`team`（可选，v1.1+）**：仅声明式——`roles[]`（id、模型/工具 profile 引用）、`topology`（`sequential` | `coordinator`）、`handoff` 简单规则；**不**在 JSON 里写图灵完备逻辑。

v1 目标：**能加载、能校验、能合并进 Session/Engine 初始化**，即使部分字段先 no-op 也要有清晰日志（`policyLoaded: true, profile: ...`）。

---

## 四、实现阶段（建议顺序）

| 阶段 | 内容 | 产出物 |
|------|------|--------|
| P0 | 设计 JSON Schema 或 Zod 类型 + `docs/architecture` 中字段冻结 | 本文件补链接或附录 |
| P1 | `loadProjectPolicy(cwd)`，与 `loadSettings` 合并（优先级：CLI > 环境变量 > local settings > project settings > **policy 中与 Settings 不冲突的键**；冲突策略写死一版文档） | `src/utils/` 下新模块或扩展 `config.ts` |
| P2 | `AgentEngine` / HTTP 层读合并结果：至少 `profile`、首阶段元数据进 `SessionState` 或等价结构 | 单测：给定 fixture policy，状态正确 |
| P3 | 与 skill 路径联动：`activateSkillPacks` 解析为现有 `skills` 加载参数 | 集成测试一条 |
| P4 | `evaluation` 仅实现一种类型（如 `script` 退出码） | 不阻塞主路径 |
| P5+ | 多 agent：`coordinator` 与 `team` 声明对齐，编排层读 `team`，子会话仍用同一 mechanism | 与 `coordinator` 模块迭代 |

---

## 五、多 Agent / Team 与本文档关系

- **本文件只约束「项目侧能声明什么」**；**调度、共享状态、handoff 存储** 在 `src/engine/` 层实现，另可在 `docs/architecture/team-orchestration.md` 中展开（需要时再写）。
- 与现有 **Coordinator 模式** 的关系：优先 **扩展/对齐** 现有 `coordinator`，避免第二套完全平行调度器。

---

## 六、风险与回滚

- **风险**：配置与代码契约漂移 → 以 `schemaVersion` + 强校验 + 弃用策略缓解。
- **回滚**：未识别或校验失败的 policy 文件 → 忽略并 warning，回退为仅 `Settings` 行为（与现网一致）。

---

## 七、本分支开发范围（建议）

- 完成 **P0–P1** 的骨架与类型；P2 以最小穿线为目标；不强制一次合入 P3–P5。
