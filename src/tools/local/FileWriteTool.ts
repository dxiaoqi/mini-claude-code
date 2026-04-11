/**
 * FileWriteTool — 文件创建/覆盖写入工具
 *
 * 将内容写入指定路径；若父目录不存在则创建，用于新建文件或覆盖已有文件。
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, isAbsolute, dirname } from 'node:path'
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  file_path: z.string().describe('The path to write the file to'),
  content: z.string().describe('The content to write to the file'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  filePath: string
  bytesWritten: number
  success: boolean
  message: string
}

export const FileWriteTool: Tool<Input, Output> = {
  name: 'FileWrite',
  aliases: ['FileWriteTool', 'Write'],
  description: 'Create or overwrite a file with the given content. Creates parent directories if they do not exist.',

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
      message: `Allow writing to: ${input.file_path}`,
      suggestions: [{
        type: 'addRules',
        rules: [{ toolName: 'FileWrite' }],
        behavior: 'allow',
        destination: 'session',
      }],
    }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const filePath = isAbsolute(input.file_path)
      ? input.file_path
      : resolve(context.cwd, input.file_path)

    try {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, input.content, 'utf-8')

      const bytesWritten = Buffer.byteLength(input.content, 'utf-8')

      return {
        data: {
          filePath,
          bytesWritten,
          success: true,
          message: `Successfully wrote ${bytesWritten} bytes to ${filePath}`,
        },
      }
    } catch (err) {
      return {
        data: {
          filePath,
          bytesWritten: 0,
          success: false,
          message: `Error writing file: ${(err as Error).message}`,
        },
      }
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
