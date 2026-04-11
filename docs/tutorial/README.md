# Mini Claude Code — 从零构建 AI 编程助手 教程

> 本教程按 Phase 顺序讲解如何从零构建一个思路对齐 Claude Code 的 AI 编程助手。
> 每一章覆盖一个 Phase 的设计思路、核心代码和关键决策。

## 目录

| 章节 | Phase | 内容 | 核心文件 |
|------|-------|------|----------|
| [00-设计哲学](./00-design-philosophy.md) | 前置 | 架构设计、与 Claude Code 的差异化、技术选型 | MINI-CLAUDE-CODE-DESIGN.md |
| [01-项目骨架与类型系统](./01-skeleton-and-types.md) | Phase 0 | package.json、tsconfig、核心类型定义 | types.ts |
| [02-API客户端与流式通信](./02-api-client.md) | Phase 1A | OpenAI/Anthropic 双 Provider、AsyncGenerator 流式设计 | api/client.ts, api/anthropicClient.ts |
| [03-Agent循环核心](./03-agent-loop.md) | Phase 1A | while(true) 主循环、5 个阶段、终止条件 | engine/agentLoop.ts |
| [04-工具系统](./04-tool-system.md) | Phase 1A-1B | Tool 接口、注册表、4 个核心工具、延迟加载 | tools/ |
| [05-权限引擎](./05-permission-engine.md) | Phase 1A-1C | 四态决策、Bash 分类器、规则匹配、持久化 | permissions/ |
| [06-上下文与Prompt设计](./06-context-and-prompt.md) | Phase 1B | ContextProvider 注入、System Prompt 分区缓存、Prompt 设计思路 | context/ |
| [07-压缩管线](./07-compact-pipeline.md) | Phase 1E | 5 层压缩、413 恢复链、token 估算 | compact/ |
| [08-MCP与Skill](./08-mcp-and-skill.md) | Phase 1D | MCP 客户端、工具适配、Skill 工作流 | mcp/, context/skills.ts |
| [09-Agent工具与子任务](./09-agent-tools.md) | Phase 1F | AgentTool、子 Agent 派生、usage 累加 | tools/agent/ |
| [10-Coordinator多Agent模式](./10-coordinator-mode.md) | Phase 2B | 协调者 Prompt、Worker Pool、并行调度 | engine/coordinator/ |
| [11-稳定性与恢复](./11-stability.md) | Phase 1C | 重试降级、max_output_tokens 恢复、文件快照 | api/retry.ts, state/ |

## 阅读建议

1. **先读 00 和 01**：建立整体认知
2. **02-03 是核心**：API 客户端和 Agent Loop 是整个系统的心脏
3. **04-05 理解能力边界**：工具系统决定 AI 能做什么，权限系统决定 AI 能做到什么程度
4. **06 是精髓**：Prompt 设计决定了 AI 的行为质量
5. **07-11 按需阅读**：压缩、MCP、多 Agent 等高级模块
