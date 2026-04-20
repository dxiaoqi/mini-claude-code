# 06 — 上下文与 Prompt 设计（Phase 1B）

## 这是整个系统最影响 AI 行为质量的部分

System Prompt 决定了 AI 的"人格"、能力认知和行为边界。好的 prompt = 好的 AI 行为。

## ContextProvider — 可注入的上下文

**核心设计**：不硬编码 Git 状态、CLAUDE.md 等，而是定义一个通用的注入接口。

```typescript
interface ContextProvider {
  name: string                // 唯一标识（用于 section cache key）
  placement: 'static' | 'dynamic'  // 注入到哪个区
  cacheBreak: boolean         // true = 每轮重新计算；false = 会话内缓存
  priority?: number           // 越小越先出现在 prompt 中
  compute(session: SessionState): Promise<string | null>  // 返回 null = 跳过
}
```

**为什么用 Provider 模式而不是硬编码？**

1. Git Context 可选（非 Git 仓库不报错）
2. 用户可自定义 Provider（如 CI 状态、Issue tracker）
3. Skill 可以注入 context
4. 每个 Provider 自声明缓存策略

**内置 Providers**：

| Provider | cacheBreak | priority | 说明 |
|----------|-----------|----------|------|
| ClaudeMd | false | 20 | 会话内只加载一次 CLAUDE.md |
| Memory | false | 30 | 会话内只加载一次 MEMORY.md |
| Git | true | 80 | 每轮重新获取 git status |
| Date | true | 90 | 每轮更新当前日期 |

## System Prompt 结构

```
┌─── Static Block (cacheScope: 'global') ──────────────────┐
│                                                           │
│  # Identity     "You are an interactive CLI agent..."     │
│  # System       工具权限模式、上下文压缩说明              │
│  # Doing tasks  软件工程任务指南、代码风格、安全           │
│  # Actions      可逆性判断、风险示例                      │
│  # Using tools  专用工具优先于 Bash                       │
│  # Output       简洁直接、重点突出                        │
│  # Tone         无 emoji、代码引用格式                    │
│  ## Available Tools  活跃工具描述列表                     │
│  ## Additional Tools  deferred 工具提示                   │
│                                                           │
│            ═══ DYNAMIC_BOUNDARY ═══                       │
│                                                           │
├─── Dynamic Block (cacheScope: null) ─────────────────────┤
│  [ClaudeMd]  ## Project Instructions                     │
│  [Memory]    ## Memory                                   │
│  [Git]       ## Git Status                               │
│  [Date]      Current date: April 6, 2026                 │
│  [Custom]    用户注入的自定义 context                     │
└──────────────────────────────────────────────────────────┘
```

**为什么要分 Static / Dynamic？**

Static 区域在不同会话之间内容相同，可以获得 Anthropic 的 `cacheScope: 'global'` 跨会话缓存（~50K token 的 prompt 只需缓存一次）。Dynamic 区域每次都可能变化，不缓存。

## Section Cache 机制

```typescript
if (!provider.cacheBreak) {
  // 会话内只计算一次，后续读缓存
  const cached = state.systemPromptSectionCache.get(provider.name)
  if (cached !== undefined) {
    value = cached
  } else {
    value = await provider.compute(state)
    state.systemPromptSectionCache.set(provider.name, value)
  }
} else {
  // cacheBreak = true: 每轮重新计算（如 git status、日期）
  value = await provider.compute(state)
}
```

`/clear` 和 `/compact` 时清空 section cache → 下一轮全部重算。

## Prompt 设计思路（对齐原版 Claude Code）

### 1. 身份定义：通用而非品牌

```
❌ "You are Lumi, an AI coding assistant"
✅ "You are an interactive CLI agent that helps users with software engineering tasks"
```

通用身份让模型不会因为名字产生奇怪的行为模式。

### 2. 工具使用：明确 "不要用 Bash 替代专用工具"

这是原版 Claude Code prompt 中最重要的指令之一：

```
Do NOT use Bash when a dedicated tool exists:
- To read files use FileRead instead of cat
- To edit files use FileEdit instead of sed
- To create files use FileWrite instead of echo redirection
- To search files use Glob instead of find
- To search content use Grep instead of grep
```

没有这条规则，AI 会倾向于用 `cat file.txt` 代替 `FileRead`，这样就失去了权限控制和结果格式化。

### 3. 输出风格：简洁直接

```
Go straight to the point. Try the simplest approach first. Be concise.
Lead with the answer or action, not the reasoning.
If you can say it in one sentence, don't use three.
```

### 4. 安全边界：具体示例

```
Examples of risky actions that warrant confirmation:
- Destructive: deleting files/branches, dropping tables, rm -rf
- Hard-to-reverse: force-pushing, git reset --hard
- Visible to others: pushing code, creating PRs, sending messages
```

### 5. 动态工具感知

```typescript
// 根据实际启用的工具动态生成指南
enabledToolNames.includes('TodoWrite')
  ? `Use TodoWrite to break down and track multi-step tasks.`
  : null
```

这保证了：有 TodoWrite 就告诉 AI 用它；没有就不提（避免混淆）。
