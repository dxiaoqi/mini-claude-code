/**
 * SkillTool — 自定义 Skill 工作流执行工具
 *
 * 加载项目内（如 <BLINO_DIR_NAME>/skills/）定义的 Skill，将对应工作流说明注入对话供模型遵循。
 */
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'
import { loadSkills, type SkillDefinition } from '../../context/skills.js'
import { BLINO_DIR_NAME } from '../../constants/blinoPaths.js'

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

let cachedSkills: SkillDefinition[] | null = null

export const SkillTool: Tool<Input, Output> = {
  name: 'Skill',
  aliases: ['SkillTool'],
  description: `Execute a project-defined skill (workflow). Skills are Markdown prompt files in ${BLINO_DIR_NAME}/skills/. Use SkillTool to discover and run them.`,

  inputSchema,
  alwaysLoad: true,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    // Load or refresh skills cache
    if (!cachedSkills) {
      cachedSkills = await loadSkills(context.sessionState.projectRoot)
    }

    // Special: list skills
    if (input.skill === 'list' || input.skill === 'help') {
      if (cachedSkills.length === 0) {
        return {
          data: {
            skillName: 'list',
            prompt: `No skills found. Create .md files in ${BLINO_DIR_NAME}/skills/ to define skills.`,
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
export function invalidateSkillCache(): void {
  cachedSkills = null
}
