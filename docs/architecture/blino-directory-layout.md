# `.blino` 目录布局与迁移方案（设计稿）

> **目标**：配置文件与项目侧数据**只认 `.blino`**（用户主目录下为 `~/.blino`），与「策略 / 流程 / 轻量评估」分层方案对齐。  
> **本文档**：说明**目录长什么样**、**对现有代码影响面**、以及**几种落地策略**，便于评审后再改实现。

---

## 1. 当前状态（迁移前）

仓库与文档目前混用 **`~/.mini-claude`** 与 **项目下 `.mini-claude/`**，典型用途如下（不完全列举）：

| 路径 | 用途 |
|------|------|
| `~/.mini-claude/settings.json` | 用户级 API、模型、MCP 等 |
| `<project>/.mini-claude/settings.json` | 项目级配置（可提交） |
| `<project>/.mini-claude/settings.local.json` | 本地覆盖（不提交） |
| `<project>/.mini-claude/server.json` | 服务锁（pid、port、cwd） |
| `~/.mini-claude/projects/<hash>/` | 会话 transcript、trace 等 |
| `~/.mini-claude/memory/<hash>/` | 会话记忆 |
| `~/.mini-claude/snapshots/`、`overflow/` 等 | 快照、大结果溢出 |
| `<project>/.mini-claude/skills/*.md` | 项目 skill |
| `~/.mini-claude/skills/` | 用户级 skill |

实现分散在：`src/utils/config.ts`、`src/mcp/config.ts`、`src/state/*`、`src/compact/sessionMemory.ts`、`src/utils/portManager.ts`、`src/context/skills.ts`、`src/engine/toolResultBudget.ts` 等；UI 与 README、教程文档大量引用 `.mini-claude`。

---

## 2. 目标状态：统一根目录名 `.blino`

**约定**：所有「根在配置目录下」的路径，**主名统一为 `.blino`**（用户家目录下为 `~/.blino`）。

### 2.1 建议的目录树（v1）

```
~/.blino/                                    # 用户级（全局）
├── settings.json
├── skills/                                  # 可选：用户级 skill
└── projects/<projectHash>/                  # transcript、jsonl、trace 等
    ├── <sessionId>.jsonl
    └── <sessionId>.trace.jsonl

<project>/.blino/                            # 项目级（与 repo 同行）
├── settings.json                            # 团队可提交
├── settings.local.json                      # 本地覆盖，建议 .gitignore
├── server.json                              # 开发/服务锁
├── workflow.json                            # 策略 / 阶段 / 轻量评估（见 layered-policy 规划）
└── skills/                                  # 项目 skill（*.md）
```

可选子目录（与现有行为对齐，仅根名从 `.mini-claude` 改为 `.blino`）：

```
~/.blino/memory/<hash>/memory.json
~/.blino/snapshots/<sessionId>/
~/.blino/overflow/<sessionId>/...
```

**说明**：

- **`workflow.json`**：承载 `schemaVersion`、`profile`、`phases`、`evaluation` 等（命名可在实现时定为 `policy.json`，但**仍放在 `.blino/` 下**）。
- **不再**在文档与代码中把 `.mini-claude` 当作**正式**路径；若需过渡期，见下文「迁移策略」。

---

## 3. 影响面（是否「很大」）

| 类别 | 影响程度 | 说明 |
|------|----------|------|
| **路径常量** | 中～大 | 所有硬编码 `'.mini-claude'` 需改为 `'.blino'` 或集中为**单处常量**（推荐 `src/utils/paths.ts` 或扩展现有 `config` 模块）。 |
| **用户磁盘数据** | 大（对外） | 已使用旧路径的用户会出现**两套目录** unless 做迁移或双读。 |
| **API/行为** | 小 | 合并规则、权限、MCP 逻辑不变，仅**读写的根目录**变化。 |
| **UI 文案** | 小 | Config 面板等展示路径需改。 |
| **文档与测试** | 中 | README、tutorial、`docs/TESTING.md`、集成测试里 `mkdir -p .mini-claude` 等需批量更新。 |

结论：**逻辑变更不大，但触达文件多**；一次性重命名若不做迁移，对老用户有**数据不连续**风险。因此更推荐 **「单源常量 + 双读一段时间 + 可选一次性复制」**（见下）。

---

## 4. 设计方案对比

### 方案 A：大爆炸（只认 `.blino`，无兼容）

- **做法**：代码与文档只使用 `.blino`；不读 `.mini-claude`。  
- **优点**：实现简单、长期无债务。  
- **缺点**：升级后用户需**手动迁移**或丢失对旧会话路径的默认发现（除非写一次性迁移脚本）。

**适用**：主版本号 bump、愿意在 Release Note 里写清迁移步骤。

---

### 方案 B：双读单写（推荐）

- **读**：先读 `~/.blino/...` / `<project>/.blino/...`，若不存在则回退读 `~/.mini-claude/...` / `<project>/.mini-claude/...`（顺序可配置，建议 **新优先**）。  
- **写**：**只写到 `.blino`**（或提供 `BLINO_HOME` 环境变量覆盖根名，高级用法）。  
- **优点**：老用户无感升级；新用户只看到 `.blino`。  
- **缺点**：过渡期需维护双读逻辑；若干版本后可删回退分支。

**适用**：当前希望平滑过渡、减少支持成本。

---

### 方案 C：启动时迁移（一次性复制/移动）

- **做法**：首次启动若检测到 **仅存在** `.mini-claude` 且 **不存在** `.blino`，则 `cp -a` 或 `mv`（需用户确认或仅 `cp` 保留原样）。  
- **优点**：目录上「只认 `.blino`」在磁盘上尽快为真。  
- **缺点**：需处理锁文件、正在运行的 server、大目录耗时；要有明确失败回滚与日志。

**适用**：与方案 B 组合：双读 + 可选引导式迁移向导（CLI `blino doctor` 之类，可后置）。

---

### 方案 D：符号链接（仅文档/开发期）

- **做法**：文档写「请使用 `.blino`」；本地可 `ln -s .mini-claude .blino` 做实验。  
- **缺点**：Windows/沙箱环境行为不一，**不适合作为产品主策略**。

---

## 5. 推荐组合（实施顺序）

1. **引入 `BLINO_DIR_NAME = '.blino'`（或 `getBlinoHome()`）**，集中所有路径构造，避免字符串散落。  
2. **实现方案 B（双读单写）**，在 `loadSettings`、skill 路径、state 路径、`portManager` 等统一走辅助函数。  
3. **文档与 UI** 全部改为展示 `.blino`；教程中说明「旧路径将在未来版本废弃」。  
4. **（可选）下一主版本** 去掉双读，或提供 `blino migrate` 将 `.mini-claude` → `.blino`。

---

## 6. 与「策略 / workflow」文件的关系

- **策略文件**（如 `workflow.json`）**只放在** `<project>/.blino/` 下，与用户/项目 `settings.json` 同级或子路径（若以后拆 `policies/` 子目录，仍根在 `.blino`）。  
- **不把** workflow 塞进 `settings.json` 的巨型嵌套，便于 code review 与机械替换；合并发生在**内存中的 `ResolvedConfig`**，而不是要求用户只维护一个 JSON。

---

## 7. 检查清单（实现 PR 时可对照）

- [ ] 用户级、项目级、`local`、锁文件、projects、memory、snapshots、overflow、skills 路径全部经统一模块  
- [ ] MCP 配置路径与 `src/mcp/config.ts` 一致  
- [ ] `cli` 帮助与错误提示中的路径  
- [ ] UI：ConfigModal / ConfigPanel  
- [ ] README、`docs/tutorial/*`、`docs/TESTING.md`  
- [ ] 集成测试 fixture 目录名  

---

## 8. 参考

- `docs/architecture/layered-policy-workflow-plan.md` — 策略层字段与分阶段实现  
