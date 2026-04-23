/**
 * SkillTool — 自定义 Skill 工作流执行工具
 *
 * 加载项目内（如 `.blino/skills/`）定义的 Skill，将对应工作流说明注入对话供模型遵循。
 */
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'
import { loadSkills, type SkillDefinition, type LoadSkillsOptions } from '../../context/skills.js'

const inputSchema = z.object({
  skill: z.string().describe('The name of the skill to execute'),
  args: z.string().optional().describe('Optional arguments to pass to the skill'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  skillName: string
  prompt: string
  found: boolean
}

const sessionSkillCache = new Map<string, SkillDefinition[] | null>()

function getLoadOptions(state: { activeSkillPacks?: string[] }): LoadSkillsOptions {
  const packs = state.activeSkillPacks
  if (packs && packs.length > 0) {
    return { includeUser: false, activateSkillPacks: packs }
  }
  return { includeUser: true }
}

export const SkillTool: Tool<Input, Output> = {
  name: 'Skill',
  aliases: ['SkillTool'],
  description: 'Execute a project-defined skill (workflow). Skills are Markdown prompt files in .blino/skills/. Use SkillTool to discover and run them.',

  inputSchema,
  alwaysLoad: true,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const sid = context.sessionState.sessionId
    let cachedSkills = sessionSkillCache.get(sid) ?? null
    if (cachedSkills === null) {
      const opts = getLoadOptions(context.sessionState)
      cachedSkills = await loadSkills(context.sessionState.projectRoot, opts)
      sessionSkillCache.set(sid, cachedSkills)
    }

    // Special: list skills
    if (input.skill === 'list' || input.skill === 'help') {
      if (cachedSkills.length === 0) {
        return {
          data: {
            skillName: 'list',
            prompt: 'No skills found. Add .md under .blino/skills/ or under packs listed in .blino/workflow.json (activateSkillPacks).',
            found: false,
          },
        }
      }

      const listing = cachedSkills.map(s =>
        `- **${s.name}**: ${s.description} (${s.source})`
      ).join('\n')

      return {
        data: {
          skillName: 'list',
          prompt: `Available skills:\n\n${listing}`,
          found: true,
        },
      }
    }

    // Find the skill
    const skill = cachedSkills.find(s => s.name === input.skill)

    if (!skill) {
      const available = cachedSkills.map(s => s.name).join(', ') || 'none'
      return {
        data: {
          skillName: input.skill,
          prompt: `Skill "${input.skill}" not found. Available skills: ${available}`,
          found: false,
        },
      }
    }

    // Build the skill prompt
    let prompt = skill.prompt
    if (input.args) {
      prompt = `${prompt}\n\nUser arguments: ${input.args}`
    }

    if (skill.allowedTools) {
      prompt = `[Allowed tools for this skill: ${skill.allowedTools.join(', ')}]\n\n${prompt}`
    }

    return {
      data: {
        skillName: skill.name,
        prompt,
        found: true,
      },
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.prompt,
      is_error: !output.found,
    }
  },
}

/**
 * Invalidate the skill cache (call when /clear or when skills directory changes).
 */
export function invalidateSkillCache(sessionId?: string): void {
  if (sessionId) {
    sessionSkillCache.delete(sessionId)
  } else {
    sessionSkillCache.clear()
  }
}
