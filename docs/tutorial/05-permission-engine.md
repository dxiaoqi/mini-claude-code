# 05 — 权限引擎（Phase 1A–1C）

## 核心思想：权限即边界

AI 可以做什么（工具），AI 能做到什么程度（权限），这是两个独立的维度。

## 决策流程（6 步）

```
Tool 请求
  ↓
① tool.validateInput()         — Zod 校验（格式错误直接拒绝）
② tool.checkPermissions()      — 工具级检查（四态）
  ├→ deny: 直接拒绝（如 rm -rf /）
  ├→ allow: 直接执行（如 FileRead）
  ├→ ask: 需要确认 + 元信息
  └→ passthrough: 交给通用引擎 → ③
③ 规则匹配                     — session > project > user > cli
  ├→ 命中 allow: 执行
  └→ 命中 deny: 拒绝
④ PermissionMode               — bypass / auto / plan / default
  ├→ bypass: 全部通过
  ├→ plan: 只读通过，写拒绝
  └→ default / auto: → ⑤
⑤ passthrough → ask 转换
⑥ 请求用户确认                 — allow / allow_always / deny
```

## 规则引擎

```typescript
interface PermissionRule {
  tool: string        // 工具名（支持 * 通配符）
  pattern?: string    // 输入模式匹配
  pathPrefix?: string // 路径前缀匹配
  decision: 'allow' | 'deny'
  source: 'session' | 'project' | 'user' | 'cli'
}
```

**优先级**：session(0) > project(1) > user(2) > cli(3)。session 规则最优先，因为它是用户在当前会话中主动批准的。

**三种匹配维度**：

```typescript
// 1. 工具名
rule.tool === 'Bash'        // 精确匹配
rule.tool === 'File*'       // 前缀通配（匹配 FileRead/FileEdit/FileWrite）
rule.tool === '*'           // 全部匹配

// 2. 输入模式（JSON.stringify 后包含检查）
rule.pattern === 'npm install'  // BashTool 的 command 包含此模式

// 3. 路径前缀（检查 file_path / path / notebook_path）
rule.pathPrefix === '/Users/me/project/'  // 只允许此目录下的文件操作
```

## 持久化

```
用户选择 "Always Allow"
  → state.permissionRules.push({ tool: 'Bash', decision: 'allow', source: 'session' })
  → CLI 退出时 → persistPermissionRules('local', projectRoot, rules)
  → 写入 .lumi/settings.local.json
  → 下次启动 → loadSettings() → 自动加载
```

## 拒绝追踪

```typescript
// 同一工具被拒绝 3 次后
function shouldFallbackToPrompting(state, toolName): boolean {
  return (state.denialCounts.get(toolName) || 0) >= 3
}
```

防止 AI 反复尝试被拒绝的操作。3 次后引擎应该提示 AI 换一种方式。

## Bash 分类器的设计

不使用原版的 tree-sitter AST 解析（太重），而是基于正则 + 前缀匹配的轻量方案：

```
                     ┌─ DANGEROUS_COMMANDS (正则): rm -rf /, mkfs, curl|bash
classifyBashCommand ─┤─ SAFE_READ_PREFIXES (前缀): ls, cat, git status, grep
                     ├─ SAFE_WRITE_PREFIXES (前缀): mkdir, npm install, git commit
                     └─ 其余 → needs_confirmation
```

多命令（`&&`, `||`, `;` 分隔）：拆分后取最高风险。
