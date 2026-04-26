/**
 * SkillCreatorTool — 创建 / 更新 / 删除本地 Skill 文件（.md + YAML frontmatter）
 */
import { z } from 'zod'
import { writeFile, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PermissionResult, Tool, ToolContext, ToolResult, ToolResultBlockParam } from '../../types.js'
import {
  BLINO_USER_SUB,
  resolveProjectBlinoPath,
  resolveUserBlinoPath,
  BLINO_PROJECT_SUB,
} from '../../constants/blinoPaths.js'
import { invalidateSkillCache } from './SkillTool.js'

const SKILL_TEMPLATES = `
## Skill 设计模板

### 模板一：纯文本生成（无工具）
\`\`\`
---
name: write-blog
description: 根据主题生成一篇结构完整的博客文章
---
你是一名资深技术博主。用户会给你一个主题。
请生成一篇结构完整的博客文章，包含：
1. 吸引人的标题
2. 摘要（50字以内）
3. 正文（3-5个章节，每章节有小标题）
4. 总结

风格：简洁、实用、避免过度技术化。
\`\`\`

### 模板二：文件操作（限定工具）
\`\`\`
---
name: git-commit
description: 分析 staged changes 并生成 commit message 然后提交
allowedTools: [Bash]
---
1. 用 git diff --staged 查看当前 staged changes
2. 分析变更内容，生成符合 Conventional Commits 规范的 commit message
   格式：<type>(<scope>): <description>
   type: feat/fix/docs/style/refactor/test/chore
3. 执行 git commit -m "<message>"
4. 告知用户提交结果
\`\`\`

### 模板三：多步骤分析（全部工具）
\`\`\`
---
name: code-review
description: 对指定文件或目录进行代码审查，给出改进建议
allowedTools: [FileRead, Glob, Grep]
---
用户会提供一个文件路径或目录。请：
1. 读取相关文件内容
2. 分析代码质量，关注：可读性、性能、安全性、最佳实践
3. 按严重程度分级输出问题：🔴 严重 / 🟡 建议 / 🟢 可选
4. 对每个问题给出具体的改进示例代码
\`\`\`

### 设计原则
- prompt 要具体，说明执行步骤而不是模糊的目标
- allowedTools 能限定就限定，避免 agent 做超出预期的操作
- description 要简洁，这是用户在 / 菜单里看到的内容
- name 用连字符分隔，如 git-commit、code-review、write-blog
`.trim()

function resolveUserSkillsDir(): string {
  return resolveUserBlinoPath(BLINO_USER_SUB.skills)
}

/** 生成安全的单行 YAML `key: value`（必要时用 JSON 引号，与 skills 解析器兼容） */
function yamlScalarLine(key: string, value: string): string {
  if (!/["\n:#]/.test(value)) return `${key}: ${value}`
  return `${key}: ${JSON.stringify(value)}`
}

const inputSchema = z.object({
  action: z
    .enum(['create', 'update', 'delete', 'list_templates'])
    .describe(
      'create: 创建新 skill | update: 更新已有 skill | delete: 删除 skill | list_templates: 列出可用模板',
    ),
  name: z
    .string()
    .optional()
    .describe('Skill 名称（action 为 delete/create/update 时必填），只允许字母、数字、连字符、下划线'),
  description: z.string().optional().describe('Skill 的一句话描述，显示在 / 菜单里'),
  allowedTools: z.array(z.string()).optional().describe('允许使用的工具列表，如 [Bash, FileRead]，留空表示不限制（frontmatter 可省略该字段）'),
  prompt: z.string().optional().describe('Skill 的 prompt 正文，描述 agent 应该如何执行这个 skill'),
  scope: z
    .enum(['project', 'user'])
    .optional()
    .describe(
      'project: 保存到当前项目 .blino/skills/（默认）| user: 保存到用户全局 ~/.blino/skills/；省略时等同 project',
    ),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  ok: boolean
  message: string
  filePath?: string
}

export const SkillCreatorTool: Tool<Input, Output> = {
  name: 'SkillCreator',
  aliases: ['SkillCreatorTool'],
  description: `创建、更新或删除本地 skill 文件。
当用户说「帮我创建一个 skill」「新建一个 skill」「我想要一个能做 X 的 skill」时使用。
创建前先调用 list_templates 了解 skill 的设计规范。
创建的 skill 立刻可在 Skill 工具中使用。`,

  inputSchema,
  alwaysLoad: true,

  isReadOnly(input) {
    return input.action === 'list_templates'
  },

  isConcurrencySafe() {
    return false
  },

  interruptBehavior() {
    return 'block'
  },

  async checkPermissions(input): Promise<PermissionResult> {
    if (input.action === 'list_templates') {
      return { behavior: 'allow' }
    }
    return {
      behavior: 'ask',
      message: `Allow SkillCreator to ${input.action} skill "${input.name ?? ''}" (${input.scope ?? 'project'} scope)?`,
      riskLevel: 'medium',
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'SkillCreator' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    }
  },

  async call(input: Input, context: ToolContext): Promise<ToolResult<Output>> {
    const projectRoot = context.sessionState.projectRoot ?? context.sessionState.cwd

    if (input.action === 'list_templates') {
      return {
        data: {
          ok: true,
          message: SKILL_TEMPLATES,
        },
      }
    }

    if (!input.name?.trim()) {
      return { data: { ok: false, message: 'name 是必填字段' } }
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(input.name)) {
      return {
        data: {
          ok: false,
          message: 'name 只允许字母、数字、连字符、下划线',
        },
      }
    }

    const scope = input.scope ?? 'project'
    const skillsDir =
      scope === 'user'
        ? resolveUserSkillsDir()
        : resolveProjectBlinoPath(projectRoot, BLINO_PROJECT_SUB.skills)

    const filePath = join(skillsDir, `${input.name}.md`)

    if (input.action === 'delete') {
      try {
        await unlink(filePath)
        invalidateSkillCache()
        return { data: { ok: true, message: `Skill "${input.name}" 已删除`, filePath } }
      } catch {
        return { data: { ok: false, message: `Skill "${input.name}" 不存在` } }
      }
    }

    if (!input.prompt?.trim()) {
      return { data: { ok: false, message: 'prompt 是必填字段' } }
    }
    if (!input.description?.trim()) {
      return { data: { ok: false, message: 'description 是必填字段' } }
    }

    const allowedToolsLine =
      input.allowedTools?.length && input.allowedTools.some(t => t.trim())
        ? `allowedTools: [${input.allowedTools.map(t => t.trim()).filter(Boolean).join(', ')}]`
        : ''

    const descLine = yamlScalarLine('description', input.description.trim())
    const frontmatter = ['---', `name: ${input.name}`, descLine, allowedToolsLine, '---']
      .filter(Boolean)
      .join('\n')

    const fileContent = `${frontmatter}\n\n${input.prompt.trim()}\n`

    await mkdir(skillsDir, { recursive: true })
    await writeFile(filePath, fileContent, 'utf-8')
    invalidateSkillCache()

    const verb = input.action === 'create' ? '创建' : '更新'
    return {
      data: {
        ok: true,
        message: `Skill "${input.name}" 已${verb}，保存到 ${filePath}`,
        filePath,
      },
    }
  },

  mapToolResultToToolResultBlockParam(output: Output, toolUseID: string): ToolResultBlockParam {
    const text = output.filePath ? `${output.message}\n(${output.filePath})` : output.message
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: text,
      is_error: !output.ok,
    }
  },
}
