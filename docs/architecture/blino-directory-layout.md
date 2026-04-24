# `.blino` 目录布局（当前实现）

> 用户与项目下的**唯一**配置与数据根目录名为 **`.blino`**（用户主目录为 `~/.blino`）。不再使用 `.mini-claude`。

---

## 目录树

```
~/.blino/
├── settings.json
├── skills/                          # 可选：用户级 skill
├── projects/<projectHash>/
│   ├── <sessionId>.jsonl
│   └── <sessionId>.trace.jsonl
├── memory/<hash>/memory.json
├── snapshots/<sessionId>/
└── overflow/<sessionId>/            # 超大 tool 输出落盘

<project>/.blino/
├── settings.json
├── settings.local.json              # 建议 .gitignore
├── server.json                      # --tui 服务锁
├── workflow.json                    # 策略/流程（规划中，见 layered-policy 文档）
└── skills/                          # 项目 skill（*.md）
```

实现上根目录名由 `src/utils/paths.ts` 中的 **`BLINO_DIR`** 导出，避免魔法字符串。

---

## 相关代码

| 用途 | 模块 |
|------|------|
| settings 合并 | `src/utils/config.ts` |
| MCP 配置 | `src/mcp/config.ts` |
| transcript / dev trace | `src/state/transcript.ts`, `src/state/devTrace.ts` |
| 快照、溢出 | `src/state/fileHistory.ts`, `src/engine/toolResultBudget.ts` |
| 会话记忆 | `src/compact/sessionMemory.ts` |
| 服务锁 | `src/utils/portManager.ts` |
| skills | `src/context/skills.ts` |

---

## 参考

- [`layered-policy-workflow-plan.md`](./layered-policy-workflow-plan.md) — `workflow.json` 字段与分阶段实现
