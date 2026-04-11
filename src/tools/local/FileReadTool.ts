/**
 * FileReadTool — 文件读取工具
 *
 * 读取文件内容，支持通过行号（offset）与行数（limit）指定读取的起始行与范围。
 */
import { readFile, stat } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  file_path: z.string().describe('The absolute or relative path to the file to read'),
  offset: z.number().optional().describe('Line number to start reading from (1-indexed)'),
  limit: z.number().optional().describe('Number of lines to read'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  content: string
  filePath: string
  totalLines: number
  startLine: number
  endLine: number
}

export const FileReadTool: Tool<Input, Output> = {
  name: 'FileRead',
  aliases: ['FileReadTool', 'Read'],
  description: 'Read the contents of a file. Supports reading specific line ranges with offset and limit parameters.',

  inputSchema,

  isReadOnly() {
    return true
  },

  isConcurrencySafe() {
    return true
  },

  backfillObservableInput(input) {
    if (typeof input.file_path === 'string' && !isAbsolute(input.file_path)) {
      input.file_path = resolve(input.file_path)
    }
  },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  maxResultSizeChars: 200_000,

  async call(input, context): Promise<ToolResult<Output>> {
    const filePath = isAbsolute(input.file_path)
      ? input.file_path
      : resolve(context.cwd, input.file_path)

    try {
      await stat(filePath)
    } catch {
      return {
        data: {
          content: `Error: File not found: ${filePath}`,
          filePath,
          totalLines: 0,
          startLine: 0,
          endLine: 0,
        },
      }
    }

    const raw = await readFile(filePath, 'utf-8')
    const allLines = raw.split('\n')
    const totalLines = allLines.length

    const startLine = input.offset ? Math.max(1, input.offset) : 1
    const endLine = input.limit
      ? Math.min(totalLines, startLine + input.limit - 1)
      : totalLines

    const selectedLines = allLines.slice(startLine - 1, endLine)
    const numbered = selectedLines.map(
      (line, i) => `${String(startLine + i).padStart(6)}|${line}`,
    )

    return {
      data: {
        content: numbered.join('\n'),
        filePath,
        totalLines,
        startLine,
        endLine,
      },
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    let content = output.content
    if (output.totalLines > 0) {
      const meta = `File: ${output.filePath} (${output.totalLines} lines, showing ${output.startLine}-${output.endLine})`
      content = `${meta}\n${content}`
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
    }
  },
}
