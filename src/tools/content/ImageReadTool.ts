/**
 * ImageReadTool — 图片读取工具
 *
 * 从本地路径读取图片文件，输出 base64 数据与媒体类型，供 Vision 等多模态 API 使用。
 */
import { readFile, stat } from 'node:fs/promises'
import { resolve, isAbsolute, extname } from 'node:path'
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  file_path: z.string().describe('Path to the image file (supports jpeg, png, gif, webp)'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  filePath: string
  mediaType: string
  base64Data: string
  sizeBytes: number
}

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

export const ImageReadTool: Tool<Input, Output> = {
  name: 'ImageRead',
  aliases: ['ImageReadTool'],
  description: 'Read an image file and encode it as base64 for vision analysis. Supports JPEG, PNG, GIF, and WebP.',

  inputSchema,
  shouldDefer: true,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  validateInput(input) {
    const ext = extname(input.file_path).toLowerCase()
    if (!SUPPORTED_EXTENSIONS[ext]) {
      return {
        result: false,
        message: `Unsupported image format: ${ext}. Supported: ${Object.keys(SUPPORTED_EXTENSIONS).join(', ')}`,
      }
    }
    return { result: true }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const filePath = isAbsolute(input.file_path)
      ? input.file_path
      : resolve(context.cwd, input.file_path)

    try {
      const fileStat = await stat(filePath)

      if (fileStat.size > MAX_IMAGE_SIZE) {
        return {
          data: {
            filePath,
            mediaType: 'error',
            base64Data: '',
            sizeBytes: fileStat.size,
          },
          metadata: { error: `Image too large: ${(fileStat.size / 1024 / 1024).toFixed(1)}MB (max 10MB)` },
        }
      }

      const buffer = await readFile(filePath)
      const ext = extname(filePath).toLowerCase()
      const mediaType = SUPPORTED_EXTENSIONS[ext] || 'image/png'

      return {
        data: {
          filePath,
          mediaType,
          base64Data: buffer.toString('base64'),
          sizeBytes: buffer.length,
        },
      }
    } catch (err) {
      return {
        data: {
          filePath,
          mediaType: 'error',
          base64Data: '',
          sizeBytes: 0,
        },
        metadata: { error: (err as Error).message },
      }
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (!output.base64Data) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Error reading image: ${output.filePath}`,
        is_error: true,
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: output.mediaType,
            data: output.base64Data,
          },
        },
        {
          type: 'text' as const,
          text: `Image: ${output.filePath} (${(output.sizeBytes / 1024).toFixed(1)}KB, ${output.mediaType})`,
        },
      ],
    }
  },
}
