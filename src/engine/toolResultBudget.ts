/**
 * 工具结果预算 — 工具结果大小限制（超限持久化到磁盘）
 *
 * 遍历消息中的 tool_result：超过字符上限时将完整内容写入会话相关目录，
 * 在消息内保留预览与文件路径，避免单次工具输出撑爆上下文。
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Message, ContentBlock, ToolResultBlock } from '../types.js'

const DEFAULT_MAX_RESULT_CHARS = 100_000
const OVERFLOW_PREVIEW_CHARS = 500

/**
 * Apply tool result size budgets to messages.
 * If a tool result exceeds maxResultSizeChars, persist it to disk
 * and replace the content with a preview + file path.
 */
export async function applyToolResultBudget(
  messages: Message[],
  sessionId: string,
): Promise<Message[]> {
  const result: Message[] = []

  for (const msg of messages) {
    if (msg.role !== 'user' || typeof msg.content === 'string') {
      result.push(msg)
      continue
    }

    const blocks = msg.content as ContentBlock[]
    let modified = false
    const newBlocks: ContentBlock[] = []

    for (const block of blocks) {
      if (block.type !== 'tool_result') {
        newBlocks.push(block)
        continue
      }

      const toolResult = block as ToolResultBlock
      const content = typeof toolResult.content === 'string'
        ? toolResult.content
        : JSON.stringify(toolResult.content)

      if (content.length <= DEFAULT_MAX_RESULT_CHARS) {
        newBlocks.push(block)
        continue
      }

      // Content exceeds budget — persist to disk
      modified = true

      try {
        const overflowDir = resolve(
          process.env.HOME || '/tmp',
          '.mini-claude', 'overflow', sessionId,
        )
        await mkdir(overflowDir, { recursive: true })

        const fileName = `${toolResult.tool_use_id}.txt`
        const filePath = resolve(overflowDir, fileName)
        await writeFile(filePath, content, 'utf-8')

        const preview = content.slice(0, OVERFLOW_PREVIEW_CHARS)
        const truncatedContent =
          `${preview}\n\n` +
          `[Output truncated: ${content.length} chars total. Full output saved to: ${filePath}]\n` +
          `Use FileRead to view the full output if needed.`

        newBlocks.push({
          ...toolResult,
          content: truncatedContent,
        })
      } catch {
        // Fallback: just truncate in-memory
        newBlocks.push({
          ...toolResult,
          content: content.slice(0, DEFAULT_MAX_RESULT_CHARS) + '\n[Output truncated]',
        })
      }
    }

    if (modified) {
      result.push({ ...msg, content: newBlocks })
    } else {
      result.push(msg)
    }
  }

  return result
}
