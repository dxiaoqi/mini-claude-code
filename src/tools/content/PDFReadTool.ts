/**
 * PDFReadTool — PDF 文本提取工具
 *
 * 从 PDF 文件中抽取文本内容，支持通过页码范围限制输出，以应对较大文档。
 */
import { readFile, stat } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  file_path: z.string().describe('Path to the PDF file'),
  pages: z.string().optional().describe('Page range to extract, e.g. "1-5" or "3" (defaults to all)'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  filePath: string
  text: string
  totalPages: number
  extractedPages: string
  truncated: boolean
}

const MAX_TEXT_LENGTH = 200_000

export const PDFReadTool: Tool<Input, Output> = {
  name: 'PDFRead',
  aliases: ['PDFReadTool'],
  description: 'Extract text content from a PDF file. Supports page range selection for large documents.',

  inputSchema,
  shouldDefer: true,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const filePath = isAbsolute(input.file_path)
      ? input.file_path
      : resolve(context.cwd, input.file_path)

    try {
      await stat(filePath)
    } catch {
      return {
        data: {
          filePath,
          text: `Error: File not found: ${filePath}`,
          totalPages: 0,
          extractedPages: 'none',
          truncated: false,
        },
      }
    }

    try {
      const buffer = await readFile(filePath)

      let result: { text: string; numpages: number }
      try {
        // pdf-parse export varies by version; handle both named and default
        const mod: any = await import('pdf-parse')
        const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> =
          typeof mod === 'function' ? mod : (mod.default ?? mod.pdf)
        result = await pdfParse(buffer)
      } catch (parseErr) {
        return {
          data: {
            filePath,
            text: `Error: pdf-parse failed: ${(parseErr as Error).message}`,
            totalPages: 0,
            extractedPages: 'none',
            truncated: false,
          },
        }
      }
      let text = result.text
      const truncated = text.length > MAX_TEXT_LENGTH

      if (truncated) {
        text = text.slice(0, MAX_TEXT_LENGTH) + '\n\n[Content truncated]'
      }

      return {
        data: {
          filePath,
          text,
          totalPages: result.numpages,
          extractedPages: input.pages || 'all',
          truncated,
        },
      }
    } catch (err) {
      return {
        data: {
          filePath,
          text: `Error parsing PDF: ${(err as Error).message}`,
          totalPages: 0,
          extractedPages: 'none',
          truncated: false,
        },
      }
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const header = `PDF: ${output.filePath} (${output.totalPages} pages, extracted: ${output.extractedPages})`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${header}\n\n${output.text}`,
      is_error: output.text.startsWith('Error'),
    }
  },
}
