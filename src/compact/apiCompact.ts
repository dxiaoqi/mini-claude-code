/**
 * 传统 API 摘要压缩 — /compact 命令
 *
 * 调用 LLM 生成完整对话摘要并重建消息列表，可将近期文件相关上下文重新注入；
 * 供用户显式 /compact 与自动压缩（auto）中的兜底策略使用。
 */
import type { APIClient, Message, SystemPromptBlock } from '../types.js'
import type { CompactionResult } from './types.js'
import { estimateMessagesTokens, estimateTokens } from './tokenEstimator.js'

const POST_COMPACT_TOKEN_BUDGET = 50_000

/**
 * Traditional API compact: call the LLM to generate a full conversation
 * summary, then rebuild the message list with recent file context re-injected.
 *
 * Used by the /compact command and as the fallback in autoCompact.
 */
export async function apiCompact(params: {
  messages: Message[]
  apiClient: APIClient
  model: string
}): Promise<CompactionResult | null> {
  const { messages, apiClient, model } = params
  const preTokens = estimateMessagesTokens(messages)

  const compactPrompt = buildCompactPrompt(messages)

  const systemPrompt: SystemPromptBlock[] = [{
    text: `You are a conversation summarizer. Create a detailed summary that captures:
1. What the user asked for and the overall goal
2. What files were read, created, or modified (with paths)
3. Key decisions made and reasoning
4. Current state of the task (what's done, what's pending)
5. Any errors encountered and how they were resolved

Be thorough — this summary will replace the conversation history.`,
    cacheScope: null,
  }]

  try {
    let summaryText = ''

    const stream = apiClient.callModel({
      model,
      systemPrompt,
      messages: [{ role: 'user', content: compactPrompt }],
      tools: [],
      maxOutputTokens: 4096,
    })

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        summaryText += event.text
      }
    }

    if (!summaryText) {
      return null
    }

    // Keep recent messages (last few exchanges)
    const recentCount = Math.min(4, Math.floor(messages.length * 0.15))
    const recentMessages = messages.slice(-recentCount)

    // Re-inject recently read file content
    const reinjectedFiles = extractRecentFileReads(messages, POST_COMPACT_TOKEN_BUDGET)

    const boundaryMessage: Message = {
      role: 'system',
      content: `[Conversation compacted]\n\n${summaryText}`,
      type: 'compact_boundary',
    }

    const newMessages: Message[] = [
      boundaryMessage,
      ...reinjectedFiles,
      ...recentMessages,
    ]

    const postTokens = estimateMessagesTokens(newMessages)

    return {
      messages: newMessages,
      preCompactTokenCount: preTokens,
      postCompactTokenCount: postTokens,
      strategy: 'api_compact',
      freedTokens: preTokens - postTokens,
    }
  } catch {
    return null
  }
}

function buildCompactPrompt(messages: Message[]): string {
  const parts: string[] = ['Summarize this conversation:\n']

  for (const msg of messages) {
    if (msg.role === 'system' && (msg as { type?: string }).type === 'compact_boundary') {
      parts.push(`[Previous summary]: ${typeof msg.content === 'string' ? msg.content.slice(0, 300) : '...'}`)
      continue
    }

    const text = typeof msg.content === 'string'
      ? msg.content
      : summarizeComplexContent(msg)

    const truncated = text.length > 800 ? text.slice(0, 800) + '...' : text
    parts.push(`${msg.role}: ${truncated}`)
  }

  return parts.join('\n\n')
}

function summarizeComplexContent(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content

  const blocks = msg.content as Array<{ type: string; text?: string; name?: string; content?: unknown }>
  const parts: string[] = []

  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text.slice(0, 200))
    } else if (block.type === 'tool_use') {
      parts.push(`[Called ${block.name}]`)
    } else if (block.type === 'tool_result') {
      const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
      parts.push(`[Tool result: ${content.slice(0, 100)}]`)
    }
  }

  return parts.join('\n')
}

/**
 * Extract file read results from recent messages for re-injection after compact.
 */
function extractRecentFileReads(
  messages: Message[],
  tokenBudget: number,
): Message[] {
  const fileReads: Array<{ path: string; content: string; index: number }> = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user' || typeof msg.content === 'string') continue

    const blocks = msg.content as Array<{ type: string; tool_use_id?: string; content?: string | unknown }>

    for (const block of blocks) {
      if (block.type !== 'tool_result') continue
      const content = typeof block.content === 'string' ? block.content : ''
      const fileMatch = content.match(/^File:\s*(.+?)(?:\s*\(|$)/m)
      if (fileMatch && content.length > 100) {
        fileReads.push({ path: fileMatch[1], content, index: i })
      }
    }
  }

  // Deduplicate by path (keep most recent), limit by token budget
  const seen = new Set<string>()
  const selected: Message[] = []
  let tokenCount = 0

  for (const fr of fileReads) {
    if (seen.has(fr.path)) continue
    seen.add(fr.path)

    const tokens = fr.content.length / 4
    if (tokenCount + tokens > tokenBudget) break

    selected.push({
      role: 'user',
      content: `[Re-injected file context]\n${fr.content}`,
    })
    tokenCount += tokens

    if (selected.length >= 5) break
  }

  return selected
}
