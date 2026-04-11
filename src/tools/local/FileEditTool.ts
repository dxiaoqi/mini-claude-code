/**
 * FileEditTool — 文件精确替换编辑工具
 *
 * 以 `old_string` → `new_string` 的方式在文件中进行精确字符串替换；可配合 `replace_all` 替换所有匹配项。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  file_path: z.string().describe('The path to the file to edit'),
  old_string: z.string().describe('The exact string to replace (must be unique in the file)'),
  new_string: z.string().describe('The replacement string'),
  replace_all: z.boolean().optional().describe('If true, replace all occurrences'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  filePath: string
  replacements: number
  success: boolean
  message: string
}

export const FileEditTool: Tool<Input, Output> = {
  name: 'FileEdit',
  aliases: ['FileEditTool', 'StrReplace'],
  description: 'Make exact string replacements in files. The old_string must uniquely identify the target text. Use replace_all to change all occurrences.',

  inputSchema,

  isReadOnly() {
    return false
  },

  isConcurrencySafe() {
    return false
  },

  interruptBehavior() {
    return 'block'
  },

  backfillObservableInput(input) {
    if (typeof input.file_path === 'string' && !isAbsolute(input.file_path)) {
      input.file_path = resolve(input.file_path)
    }
  },

  async checkPermissions(input): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: `Allow editing: ${input.file_path}`,
      suggestions: [{
        type: 'addRules',
        rules: [{ toolName: 'FileEdit' }],
        behavior: 'allow',
        destination: 'session',
      }],
    }
  },

  validateInput(input) {
    if (input.old_string === input.new_string) {
      return { result: false, message: 'old_string and new_string must be different' }
    }
    return { result: true }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const filePath = isAbsolute(input.file_path)
      ? input.file_path
      : resolve(context.cwd, input.file_path)

    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch {
      return {
        data: {
          filePath,
          replacements: 0,
          success: false,
          message: `Error: File not found: ${filePath}`,
        },
      }
    }

    if (!content.includes(input.old_string)) {
      return {
        data: {
          filePath,
          replacements: 0,
          success: false,
          message: 'Error: old_string not found in file. Make sure it matches exactly, including whitespace and indentation.',
        },
      }
    }

    if (!input.replace_all) {
      const occurrences = content.split(input.old_string).length - 1
      if (occurrences > 1) {
        return {
          data: {
            filePath,
            replacements: 0,
            success: false,
            message: `Error: old_string has ${occurrences} occurrences. Provide more context to make it unique, or set replace_all: true.`,
          },
        }
      }
    }

    let newContent: string
    let replacements: number

    if (input.replace_all) {
      const parts = content.split(input.old_string)
      replacements = parts.length - 1
      newContent = parts.join(input.new_string)
    } else {
      replacements = 1
      newContent = content.replace(input.old_string, input.new_string)
    }

    await writeFile(filePath, newContent, 'utf-8')

    return {
      data: {
        filePath,
        replacements,
        success: true,
        message: `Successfully replaced ${replacements} occurrence(s) in ${filePath}`,
      },
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.message,
      is_error: !output.success,
    }
  },
}
