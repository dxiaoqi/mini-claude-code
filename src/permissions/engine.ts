/**
 * 权限引擎 — 工具调用的权限检查核心
 *
 * 决策流程（与设计文档 §3.5 对齐）：
 *   ① tool.validateInput() — Zod schema 校验
 *   ② tool.checkPermissions() — 工具级权限检查（四态：allow/ask/deny/passthrough）
 *   ③ 规则引擎匹配（优先级：session > project > user > cli）
 *   ④ PermissionMode 决策（bypass/auto/plan/default）
 *   ⑤ passthrough → ask 转换
 *   ⑥ 请求用户确认
 */

import type {
  PermissionMode,
  PermissionResult,
  PermissionRule,
  SessionState,
  Tool,
  ToolContext,
} from '../types.js'
import { runPreToolUseHooks } from '../utils/hooks.js'

export async function checkToolPermission(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<PermissionResult> {
  const state = context.sessionState

  // ① 工具输入校验
  if (tool.validateInput) {
    const validation = await tool.validateInput(input as never, context)
    if (!validation.result) {
      return { behavior: 'deny', reason: validation.message || 'Input validation failed' }
    }
  }

  // ② 工具级权限检查
  const toolPermission = await tool.checkPermissions(input as never, context)
  if (toolPermission.behavior === 'deny') {
    return toolPermission
  }
  if (toolPermission.behavior === 'allow') {
    return toolPermission
  }

  // ② .5 PreToolUse hooks（在规则匹配之前）
  const hooksSettings = state.settings?.hooks as import('../utils/hooks.js').HooksSettings | undefined
  if (hooksSettings?.PreToolUse?.length) {
    const hookResult = await runPreToolUseHooks(hooksSettings, tool, input, context.cwd)
    if (hookResult?.preventExecution) {
      return { behavior: 'deny', reason: hookResult.reason || 'Denied by PreToolUse hook' }
    }
    if (hookResult?.updatedInput) {
      Object.assign(input, hookResult.updatedInput)
    }
  }

  // ③ 规则引擎匹配（session > project > user > cli 优先级）
  const ruleResult = matchRules(tool.name, input, state.permissionRules)
  if (ruleResult) {
    return ruleResult
  }

  // ④ PermissionMode 决策
  switch (state.permissionMode) {
    case 'bypass':
      return { behavior: 'allow' }

    case 'plan':
      if (tool.isReadOnly?.(input as never)) {
        return { behavior: 'allow' }
      }
      return { behavior: 'deny', reason: 'Write operations are not allowed in plan mode' }

    case 'auto':
      if (tool.isReadOnly?.(input as never)) {
        return { behavior: 'allow' }
      }
      break

    case 'default':
    default:
      break
  }

  // ⑤ passthrough → ask 转换
  if (toolPermission.behavior === 'passthrough') {
    return {
      behavior: 'ask',
      message: toolPermission.message,
      suggestions: toolPermission.suggestions,
    }
  }

  return {
    behavior: 'ask',
    message: `${tool.name} requires permission.`,
  }
}

/**
 * 规则匹配引擎
 *
 * 优先级（数字越小越优先）：session(0) > project(1) > user(2) > cli(3)
 * 支持：工具名通配符、输入模式匹配、路径前缀匹配
 */
function matchRules(
  toolName: string,
  input: Record<string, unknown>,
  rules: PermissionRule[],
): PermissionResult | null {
  const sourcePriority: Record<string, number> = {
    session: 0,
    project: 1,
    user: 2,
    cli: 3,
  }

  const sorted = [...rules].sort(
    (a, b) => (sourcePriority[a.source] ?? 99) - (sourcePriority[b.source] ?? 99),
  )

  for (const rule of sorted) {
    // 工具名匹配（支持 * 通配符）
    if (!toolMatchesRule(toolName, rule.tool)) continue

    // 输入模式匹配（可选）
    if (rule.pattern) {
      const inputStr = JSON.stringify(input)
      if (!inputStr.includes(rule.pattern)) continue
    }

    // 路径前缀匹配（可选）— 检查 file_path / path / notebook_path
    if (rule.pathPrefix) {
      const filePath = (input.file_path || input.path || input.notebook_path) as string | undefined
      if (!filePath || !filePath.startsWith(rule.pathPrefix)) continue
    }

    if (rule.decision === 'allow') {
      return { behavior: 'allow' }
    }
    if (rule.decision === 'deny') {
      return { behavior: 'deny', reason: `Denied by ${rule.source} rule` }
    }
  }

  return null
}

/** 工具名匹配：精确匹配或 * 通配符前缀 */
function toolMatchesRule(toolName: string, ruleToolPattern: string): boolean {
  if (ruleToolPattern === '*') return true
  if (ruleToolPattern === toolName) return true
  if (ruleToolPattern.endsWith('*')) {
    return toolName.startsWith(ruleToolPattern.slice(0, -1))
  }
  return false
}

/**
 * 记录工具拒绝次数。同一工具被拒绝 3 次后 shouldFallbackToPrompting 返回 true。
 */
export function recordDenial(state: SessionState, toolName: string): void {
  const count = (state.denialCounts.get(toolName) || 0) + 1
  state.denialCounts.set(toolName, count)
}

/**
 * 检查是否应该 fallback to prompting（同一工具被拒绝 >= 3 次）。
 */
export function shouldFallbackToPrompting(state: SessionState, toolName: string): boolean {
  return (state.denialCounts.get(toolName) || 0) >= 3
}
