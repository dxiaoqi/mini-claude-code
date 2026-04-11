/**
 * 日期上下文 — 当前日期上下文提供者
 *
 * ContextProvider：注入格式化的当前日期（en-US 长格式），高优先级且随时间失效，
 * 使模型在无用户说明时也能对齐「今天」的日历语境。
 */
import type { ContextProvider } from '../../types.js'

export const dateContextProvider: ContextProvider = {
  name: 'date',
  placement: 'dynamic',
  cacheBreak: true,
  priority: 90,
  async compute() {
    const now = new Date()
    const formatted = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    return `Current date: ${formatted}`
  },
}
