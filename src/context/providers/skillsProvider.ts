/**
 * Skills 上下文 — 在 session 启动时加载可用 skill 列表并注入 system-reminder
 *
 * 让模型在第一轮就知道有哪些 skill，避免盲目调用不存在的 skill 浪费一轮 API。
 */
import type { ContextProvider, SessionState } from '../../types.js'
import { loadSkills } from '../skills.js'

export const skillsProvider: ContextProvider = {
  name: 'skills',
  placement: 'dynamic',
  cacheBreak: false,
  priority: 20,

  async compute(session: SessionState): Promise<string | null> {
    const skills = await loadSkills(session.projectRoot)
    if (skills.length === 0) return null

    const list = skills
      .map(s => `- ${s.name}: Use when ${s.description}. Examples: "${s.name} ..."`)
      .join('\n')

    return `<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n${list}\n\nWhen using the Skill tool, you must specify a skill name parameter to select which skill to use.\n</system-reminder>`
  },
}
