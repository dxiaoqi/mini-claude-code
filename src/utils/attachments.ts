/**
 * utils/attachments.ts — @ 附件预处理
 *
 * 解析用户输入中的 @filepath 引用：
 *   - @file.txt / @src/main.ts → 展开为文件内容（FileRead）
 *   - @image.png / @photo.jpg  → 读取为 base64 image block（Vision）
 *   - @dir/                   → 展开为目录下文件列表
 */

import { readFile, stat, readdir } from 'node:fs/promises'
import { resolve, isAbsolute, extname, relative } from 'node:path'
import type { ContentBlock, ImageBlock, TextBlock } from '../types.js'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export interface AttachmentResult {
  /** 原始用户输入（@ref 已移除） */
  cleanText: string
  /** 附加的内容 blocks（文件内容或图片） */
  blocks: ContentBlock[]
  /** 展开的附件说明（供 UI 显示） */
  attachmentSummaries: string[]
}

/**
 * 解析用户输入，展开所有 @filepath 引用。
 * 返回清理后的文本和对应的 content blocks。
 */
export async function processAttachments(
  input: string,
  cwd: string,
): Promise<AttachmentResult> {
  // 匹配 @filepath（支持相对路径和绝对路径）
  // 路径可以包含字母、数字、/_.-，但不含空格
  const ATTACHMENT_RE = /@([^\s@]+)/g
  const matches = [...input.matchAll(ATTACHMENT_RE)]

  if (matches.length === 0) {
    return { cleanText: input, blocks: [], attachmentSummaries: [] }
  }

  const blocks: ContentBlock[] = []
  const attachmentSummaries: string[] = []
  let cleanText = input

  for (const match of matches) {
    const rawPath = match[1]
    const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)

    try {
      const s = await stat(absPath)

      if (s.isDirectory()) {
        // 目录 → 列出内容
        const entries = await readdir(absPath)
        const listing = entries.slice(0, 50).join('\n')
        const truncated = entries.length > 50 ? `\n... (${entries.length - 50} more)` : ''
        const relPath = relative(cwd, absPath)

        blocks.push({
          type: 'text',
          text: `Directory: ${relPath}/\n${listing}${truncated}`,
        } as TextBlock)
        attachmentSummaries.push(`@${rawPath} (directory, ${entries.length} entries)`)

      } else if (IMAGE_EXTENSIONS.has(extname(absPath).toLowerCase())) {
        // 图片 → base64 image block
        const MAX_IMAGE = 10 * 1024 * 1024  // 10MB
        if (s.size > MAX_IMAGE) {
          blocks.push({ type: 'text', text: `[Image too large: ${rawPath} (${(s.size / 1024 / 1024).toFixed(1)}MB, max 10MB)]` } as TextBlock)
          attachmentSummaries.push(`@${rawPath} (too large, skipped)`)
        } else {
          const buf = await readFile(absPath)
          const ext = extname(absPath).toLowerCase()
          const mediaType = IMAGE_MIME[ext] || 'image/png'
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') },
          } as ImageBlock)
          attachmentSummaries.push(`@${rawPath} (image, ${(s.size / 1024).toFixed(0)}KB)`)
        }

      } else {
        // 文本文件 → 读取内容
        const MAX_FILE = 200_000
        const content = await readFile(absPath, 'utf-8')
        const truncated = content.length > MAX_FILE
        const text = truncated ? content.slice(0, MAX_FILE) + '\n[Truncated]' : content
        const relPath = relative(cwd, absPath)
        const lineCount = content.split('\n').length

        blocks.push({
          type: 'text',
          text: `File: ${relPath} (${lineCount} lines)\n\`\`\`\n${text}\n\`\`\``,
        } as TextBlock)
        attachmentSummaries.push(`@${rawPath} (${lineCount} lines${truncated ? ', truncated' : ''})`)
      }

      // 从输入中移除 @ref 标记（保留周围空格整洁）
      cleanText = cleanText.replace(match[0], '').trim()

    } catch {
      // 文件不存在或读取失败 → 保留原始 @ref 让用户知道
      attachmentSummaries.push(`@${rawPath} (not found)`)
    }
  }

  return { cleanText, blocks, attachmentSummaries }
}

/**
 * 将附件 blocks 与文本合并为 content 数组，供 UserMessage 使用。
 */
export function buildContentWithAttachments(
  text: string,
  blocks: ContentBlock[],
): string | ContentBlock[] {
  if (blocks.length === 0) return text

  const result: ContentBlock[] = []
  if (text) {
    result.push({ type: 'text', text } as TextBlock)
  }
  result.push(...blocks)
  return result
}
