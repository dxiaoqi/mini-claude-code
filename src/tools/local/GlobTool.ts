/**
 * GlobTool — 文件名模式搜索工具
 *
 * 使用 fast-glob 在给定目录下按 glob 模式匹配文件路径，用于按文件名模式快速发现文件。
 */
import fg from 'fast-glob'
import { resolve, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  pattern: z.string().describe('Glob pattern to match files (e.g. "**/*.ts", "src/**/*.json")'),
  path: z.string().optional().describe('Directory to search in (defaults to cwd)'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  files: string[]
  count: number
  pattern: string
}

export const GlobTool: Tool<Input, Output> = {
  name: 'Glob',
  aliases: ['GlobTool'],
  description: 'Find files matching a glob pattern. Fast file discovery by name patterns.',

  inputSchema,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  maxResultSizeChars: 100_000,

  async call(input, context): Promise<ToolResult<Output>> {
    const searchDir = input.path
      ? (isAbsolute(input.path) ? input.path : resolve(context.cwd, input.path))
      : context.cwd

    let pattern = input.pattern
    if (!pattern.startsWith('**/') && !pattern.startsWith('/') && !pattern.startsWith('./')) {
      pattern = `**/${pattern}`
    }

    try {
      const files = await fg(pattern, {
        cwd: searchDir,
        dot: false,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
        onlyFiles: true,
        absolute: false,
      })

      files.sort()

      return {
        data: {
          files: files.slice(0, 1000),
          count: files.length,
          pattern: input.pattern,
        },
      }
    } catch (err) {
      return {
        data: {
          files: [],
          count: 0,
          pattern: input.pattern,
        },
        metadata: { error: (err as Error).message },
      }
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    let content: string
    if (output.count === 0) {
      content = `No files matched pattern: ${output.pattern}`
    } else {
      const shown = output.files.join('\n')
      content = output.count > 1000
        ? `Found ${output.count} files (showing first 1000):\n${shown}`
        : `Found ${output.count} file(s):\n${shown}`
    }
    return { tool_use_id: toolUseID, type: 'tool_result', content }
  },
}
