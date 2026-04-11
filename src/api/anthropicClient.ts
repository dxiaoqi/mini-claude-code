import Anthropic from '@anthropic-ai/sdk'
import type {
  APIClient,
  CallModelParams,
  ContentBlock,
  PromptCacheLatches,
  StreamEvent,
  Usage,
} from '../types.js'

export interface AnthropicCompatibleConfig {
  apiKey: string
  baseURL: string
  defaultModel?: string
}

export function createAnthropicClient(config: AnthropicCompatibleConfig): APIClient {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  })

  return {
    async *callModel(params: CallModelParams): AsyncGenerator<StreamEvent> {
      // Build system blocks with cache_control for cacheScope-enabled blocks
      const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = []
      for (const block of params.systemPrompt) {
        const sysBlock: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } } = {
          type: 'text',
          text: block.text,
        }
        if (block.cacheScope === 'global' || block.cacheScope === 'ephemeral') {
          sysBlock.cache_control = { type: 'ephemeral' }
        }
        systemBlocks.push(sysBlock)
      }
      const systemText = systemBlocks.length === 1
        ? systemBlocks[0].text
        : params.systemPrompt.map(b => b.text).join('\n\n')
      const useBlockSystem = systemBlocks.length > 1 && systemBlocks.some(b => b.cache_control)

      const messages: Anthropic.MessageParam[] = []

      for (const msg of params.messages) {
        if (msg.role === 'system') continue

        if (msg.role === 'user') {
          if (typeof msg.content === 'string') {
            messages.push({ role: 'user', content: msg.content })
          } else {
            const blocks: Anthropic.ContentBlockParam[] = []
            for (const block of msg.content) {
              if (block.type === 'text') {
                blocks.push({ type: 'text', text: block.text })
              } else if (block.type === 'image') {
                blocks.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: block.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                    data: block.source.data,
                  },
                })
              } else if (block.type === 'tool_result') {
                blocks.push({
                  type: 'tool_result',
                  tool_use_id: block.tool_use_id,
                  content: typeof block.content === 'string'
                    ? block.content
                    : (block.content as Array<{type: string; text?: string}>)
                        .filter(b => b.type === 'text')
                        .map(b => ({ type: 'text' as const, text: b.text || '' })),
                  is_error: block.is_error,
                })
              }
            }
            if (blocks.length > 0) {
              messages.push({ role: 'user', content: blocks })
            }
          }
        }

        if (msg.role === 'assistant') {
          if (typeof msg.content === 'string') {
            messages.push({ role: 'assistant', content: msg.content })
          } else {
            const blocks: Anthropic.ContentBlockParam[] = []
            for (const block of msg.content) {
              if (block.type === 'text') {
                blocks.push({ type: 'text', text: block.text })
              } else if (block.type === 'tool_use') {
                blocks.push({
                  type: 'tool_use',
                  id: block.id,
                  name: block.name,
                  input: block.input,
                })
              }
            }
            if (blocks.length > 0) {
              messages.push({ role: 'assistant', content: blocks })
            }
          }
        }
      }

      const tools: Anthropic.Tool[] | undefined =
        params.tools.length > 0
          ? params.tools.map(t => ({
              name: t.function.name,
              description: t.function.description,
              input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
            }))
          : undefined

      // ── Prompt Cache Latch: sticky-on beta headers ──
      // 一旦某个 beta header 在会话中被首次启用，永远保持发送直到 /clear 或 /compact
      // 这防止 mid-session 切换 header 导致 cache key 改变而失效 50-70K token 的静态 prompt
      const latches = params.promptCacheLatches
      const betas: string[] = []
      if (latches?.autoModeHeaderLatched === true) {
        betas.push('interleaved-thinking-2025-05-14')
      }

      const requestParams: Record<string, unknown> = {
        model: params.model || config.defaultModel || 'claude-sonnet-4-20250514',
        max_tokens: params.maxOutputTokens || 8192,
        messages,
        tools,
        ...(betas.length > 0 ? { betas } : {}),
      }
      if (useBlockSystem) {
        requestParams.system = systemBlocks
      } else if (systemText) {
        requestParams.system = systemText
      }

      // thinking_clear latch：超过 1 小时未调 API，清除 thinking blocks（已确认 cache miss）
      if (latches?.thinkingClearLatched === true) {
        // 在下一版支持 thinking 时：设置 context_management: { clear_all_thinking: true }
      }

      const stream = client.messages.stream(
        requestParams as Anthropic.MessageStreamParams,
        { signal: params.signal ?? undefined },
      )

      let messageId = ''
      let model = params.model
      const totalUsage: Usage = { inputTokens: 0, outputTokens: 0 }
      let stopReason = 'end_turn'

      // 追踪当前正在流式接收的 tool_use block
      let currentToolUseId = ''
      let currentToolUseName = ''
      let currentToolUseJson = ''

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start': {
            const msg = event.message
            messageId = msg.id
            model = msg.model
            totalUsage.inputTokens = msg.usage?.input_tokens || 0
            yield { type: 'message_start', messageId, model }
            break
          }

          case 'content_block_start': {
            const block = event.content_block
            if (block.type === 'tool_use') {
              // 记录 tool_use 的 id 和 name，input 通过 delta 增量接收
              currentToolUseId = block.id
              currentToolUseName = block.name
              currentToolUseJson = ''
            }
            break
          }

          case 'content_block_delta': {
            const delta = event.delta as unknown as Record<string, unknown>
            if (delta.type === 'text_delta') {
              yield { type: 'text_delta', text: (delta as { text: string }).text }
            } else if (delta.type === 'thinking_delta') {
              // Thinking block（extended thinking）
              yield { type: 'thinking_delta', thinking: (delta as { thinking: string }).thinking }
            } else if (delta.type === 'input_json_delta' && currentToolUseId) {
              // 增量累积 tool input JSON
              currentToolUseJson += (delta as { partial_json: string }).partial_json || ''
            }
            break
          }

          case 'content_block_stop': {
            // tool_use block 结束时，解析完整 input 并 yield tool_use_start
            // 这样 StreamingToolExecutor 可以在流式过程中开始执行
            if (currentToolUseId) {
              let input: Record<string, unknown> = {}
              try {
                input = JSON.parse(currentToolUseJson || '{}')
              } catch { /* fallback to empty */ }

              yield {
                type: 'tool_use_start',
                id: currentToolUseId,
                name: currentToolUseName,
                input,
              }

              currentToolUseId = ''
              currentToolUseName = ''
              currentToolUseJson = ''
            }
            break
          }

          case 'message_delta': {
            const delta = event.delta as unknown as Record<string, unknown>
            stopReason = (delta.stop_reason as string) || 'end_turn'
            const deltaUsage = event.usage as unknown as { output_tokens?: number } | undefined
            if (deltaUsage?.output_tokens) {
              totalUsage.outputTokens = deltaUsage.output_tokens
            }
            break
          }

          case 'message_stop': {
            break
          }
        }
      }

      // 从 finalMessage 获取精确的 usage（流式 delta 可能不完整）
      const finalMessage = await stream.finalMessage()
      if (finalMessage.stop_reason === 'tool_use') {
        stopReason = 'tool_use'
      }
      totalUsage.inputTokens = finalMessage.usage.input_tokens
      totalUsage.outputTokens = finalMessage.usage.output_tokens

      yield { type: 'message_end', usage: totalUsage, stopReason }
    },
  }
}
