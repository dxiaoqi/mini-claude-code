/**
 * 被动紧急压缩 — 413 错误时即时 API 压缩
 *
 * 当请求因上下文过长返回 413 时，单独调用模型生成对话摘要并重建消息列表，
 * 成功后由上层重试原请求；同一失败路径内仅尝试一次，避免循环。
 */
import type { APIClient, Message, SystemPromptBlock } from '../types.js'
import type { CompactionResult } from './types.js'
import { estimateMessagesTokens, estimateTokens } from './tokenEstimator.js'

/**
 * Reactive compact: emergency compaction triggered by 413 prompt_too_long.
 * Calls the LLM to generate a summary, then rebuilds the message list.
 *
 * Flow:
 *   1. Withhold the 413 error from the stream
 *   2. Call this function to compress
 *   3. If successful, retry the original request with compressed messages
 *   4. If failed, propagate the error
 */
export async function tryReactiveCompact(params: {
  messages: Message[]
  apiClient: APIClient
  model: string
  hasAttempted: boolean
}): Promise<CompactionResult | null> {
  if (params.hasAttempted) {
    return null // Only try once
  }

  const { messages, apiClient, model } = params
  const preTokens = estimateMessagesTokens(messages)

  // Build a compact request: ask the model to summarize the conversation
  const compactMessages: Message[] = [
    {
      role: 'user',
      content: buildCompactPrompt(messages),
    },
  ]

  const systemPrompt: SystemPromptBlock[] = [{
    text: 'You are a conversation summarizer. Produce a concise summary of the conversation that preserves all important context, decisions, file changes, and pending tasks. Be thorough but compact.',
    cacheScope: null,
  }]

  try {
    let summaryText = ''

    const stream = apiClient.callModel({
      model,
      systemPrompt,
      messages: compactMessages,
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

    // Rebuild messages: boundary + summary + recent messages
    const recentCount = Math.min(6, Math.floor(messages.length * 0.2))
    const recentMessages = messages.slice(-recentCount)

    const boundaryMessage: Message = {
      role: 'system',
      content: `[Reactive compact: conversation summarized due to context overflow]\n\n${summaryText}`,
      type: 'compact_boundary',
    }

    const newMessages = [boundaryMessage, ...recentMessages]
    const postTokens = estimateMessagesTokens(newMessages)

    return {
      messages: newMessages,
      preCompactTokenCount: preTokens,
      postCompactTokenCount: postTokens,
      strategy: 'reactive',
      freedTokens: preTokens - postTokens,
    }
  } catch {
    return null
  }
}

function buildCompactPrompt(messages: Message[]): string {
  const parts: string[] = ['Please summarize this conversation concisely:\n']

  for (const msg of messages) {
    if (msg.role === 'system') continue

    const text = typeof msg.content === 'string'
      ? msg.content
      : '[complex content with tool calls]'

    const truncated = text.length > 500 ? text.slice(0, 500) + '...' : text
    parts.push(`${msg.role}: ${truncated}`)
  }

  return parts.join('\n\n')
}
