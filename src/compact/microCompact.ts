/**
 * 局部压缩 — 清除旧工具输出详情，保留元数据
 *
 * 对较早轮次中可压缩工具（Bash、文件读写、搜索、抓取等）的 tool_result 正文
 * 替换为占位说明，保留工具名、路径、命令等元信息；不调用 API。
 */
import type { Message, ContentBlock, ToolResultBlock, ToolUseBlock } from '../types.js'

const COMPACTABLE_TOOLS = new Set([
  'Bash', 'BashTool',
  'FileRead', 'FileReadTool', 'Read',
  'Grep', 'GrepTool',
  'Glob', 'GlobTool',
  'WebFetch', 'WebFetchTool',
  'PDFRead', 'PDFReadTool',
])

const CLEARED_PLACEHOLDER = '[Old tool result content cleared to save context]'

interface MicroCompactConfig {
  turnsToKeep: number
  minContentLengthToCompact: number
}

const DEFAULT_CONFIG: MicroCompactConfig = {
  turnsToKeep: 5,
  minContentLengthToCompact: 500,
}

/**
 * Micro compact: clear the detailed content of old tool results while
 * preserving their metadata (tool name, file paths, commands).
 * No API call needed.
 */
export function microCompact(
  messages: Message[],
  config: Partial<MicroCompactConfig> = {},
): Message[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Count assistant turns from the end to determine which messages are "old"
  let assistantTurnCount = 0
  const turnBoundaries: number[] = []

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      assistantTurnCount++
      turnBoundaries.push(i)
    }
  }

  if (assistantTurnCount <= cfg.turnsToKeep) {
    return messages
  }

  // Find the cutoff: messages before this index are "old"
  const cutoffTurnIndex = turnBoundaries[cfg.turnsToKeep - 1] ?? 0

  return messages.map((msg, idx) => {
    if (idx >= cutoffTurnIndex) return msg
    if (msg.role !== 'user' || typeof msg.content === 'string') return msg

    const blocks = msg.content as ContentBlock[]
    const hasToolResults = blocks.some(b => b.type === 'tool_result')
    if (!hasToolResults) return msg

    const newBlocks = blocks.map(block => {
      if (block.type !== 'tool_result') return block

      const toolResult = block as ToolResultBlock
      const content = typeof toolResult.content === 'string'
        ? toolResult.content
        : JSON.stringify(toolResult.content)

      if (content.length < cfg.minContentLengthToCompact) return block

      // Find the corresponding tool_use to extract metadata
      const toolName = findToolName(messages, toolResult.tool_use_id)
      if (!toolName || !COMPACTABLE_TOOLS.has(toolName)) return block

      const summary = buildToolSummary(toolName, toolResult, content)

      return {
        ...toolResult,
        content: summary,
      }
    })

    return { ...msg, content: newBlocks }
  })
}

function findToolName(messages: Message[], toolUseId: string): string | null {
  for (const msg of messages) {
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue
    const blocks = msg.content as ContentBlock[]
    for (const block of blocks) {
      if (block.type === 'tool_use' && (block as ToolUseBlock).id === toolUseId) {
        return (block as ToolUseBlock).name
      }
    }
  }
  return null
}

function buildToolSummary(
  toolName: string,
  toolResult: ToolResultBlock,
  content: string,
): string {
  const lines = content.split('\n')
  const lineCount = lines.length
  const charCount = content.length

  switch (toolName) {
    case 'Bash':
    case 'BashTool': {
      const firstLine = lines[0]?.slice(0, 100) || ''
      const hasError = toolResult.is_error || content.includes('[Exit code:')
      return `${CLEARED_PLACEHOLDER}\n` +
        `Tool: Bash | Output: ${lineCount} lines, ${charCount} chars` +
        (hasError ? ' [had errors]' : '') +
        `\nPreview: ${firstLine}...`
    }

    case 'FileRead':
    case 'FileReadTool':
    case 'Read': {
      const fileMatch = content.match(/^File:\s*(.+?)(?:\s*\(|$)/m)
      const fileName = fileMatch?.[1] || 'unknown'
      return `${CLEARED_PLACEHOLDER}\nTool: FileRead | File: ${fileName} | ${lineCount} lines`
    }

    case 'Grep':
    case 'GrepTool': {
      const matchCount = lines.filter(l => l.match(/^.+?:\d+:/)).length
      return `${CLEARED_PLACEHOLDER}\nTool: Grep | ${matchCount} matches found`
    }

    case 'Glob':
    case 'GlobTool': {
      const fileCount = lines.filter(l => l.trim() && !l.startsWith('Found')).length
      return `${CLEARED_PLACEHOLDER}\nTool: Glob | ${fileCount} files found`
    }

    case 'WebFetch':
    case 'WebFetchTool': {
      const urlMatch = content.match(/^URL:\s*(.+?)(?:\s|$)/m)
      return `${CLEARED_PLACEHOLDER}\nTool: WebFetch | URL: ${urlMatch?.[1] || 'unknown'} | ${charCount} chars`
    }

    default:
      return `${CLEARED_PLACEHOLDER}\nTool: ${toolName} | ${lineCount} lines, ${charCount} chars`
  }
}
