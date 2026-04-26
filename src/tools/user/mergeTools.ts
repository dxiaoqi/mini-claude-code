import type { Tool } from '../../types.js'

/** 用户工具同名时覆盖内置工具 */
export function mergeTools(baseTools: Tool[], userTools: Tool[]): Tool[] {
  const userNames = new Set(userTools.map(t => t.name))
  return [...baseTools.filter(t => !userNames.has(t.name)), ...userTools]
}
