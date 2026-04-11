/**
 * api/client.ts — OpenAI 兼容 API 客户端
 *
 * 基于 OpenAI SDK 调用兼容接口，以 AsyncGenerator 流式产出 StreamEvent。
 */
import OpenAI from 'openai'
import type {
  APIClient,
  CallModelParams,
  StreamEvent,
  Usage,
} from '../types.js'

export interface OpenAICompatibleConfig {
  apiKey: string
  baseURL: string
  defaultModel?: string
}

export function createOpenAICompatibleClient(config: OpenAICompatibleConfig): APIClient {
  const openai = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })

  return {
    async *callModel(params: CallModelParams): AsyncGenerator<StreamEvent> {
      const systemContent = params.systemPrompt
        .map(b => b.text)
        .join('\n\n')

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

      if (systemContent) {
        messages.push({ role: 'system', content: systemContent })
      }

      for (const msg of params.messages) {
        if (msg.role === 'system') continue

        if (msg.role === 'user') {
          if (typeof msg.content === 'string') {
            messages.push({ role: 'user', content: msg.content })
          } else {
            const parts: OpenAI.Chat.ChatCompletionContentPart[] = []
            for (const block of msg.content) {
              if (block.type === 'text') {
                parts.push({ type: 'text', text: block.text })
              } else if (block.type === 'image') {
                parts.push({
                  type: 'image_url',
                  image_url: {
                    url: `data:${block.source.media_type};base64,${block.source.data}`,
                  },
                })
              } else if (block.type === 'tool_result') {
                messages.push({
                  role: 'tool',
                  tool_call_id: block.tool_use_id,
                  content: typeof block.content === 'string'
                    ? block.content
                    : block.content.map(b => 'text' in b ? b.text : '').join('\n'),
                })
                continue
              }
            }
            if (parts.length > 0) {
              messages.push({ role: 'user', content: parts })
            }
          }
        }

        if (msg.role === 'assistant') {
          if (typeof msg.content === 'string') {
            messages.push({ role: 'assistant', content: msg.content })
          } else {
            const textParts: string[] = []
            const toolCalls: Array<{id: string; type: 'function'; function: {name: string; arguments: string}}> = []

            for (const block of msg.content) {
              if (block.type === 'text') {
                textParts.push(block.text)
              } else if (block.type === 'tool_use') {
                toolCalls.push({
                  id: block.id,
                  type: 'function' as const,
                  function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input),
                  },
                })
              }
            }

            if (toolCalls.length > 0) {
              messages.push({
                role: 'assistant',
                content: textParts.join('\n') || null,
                tool_calls: toolCalls as OpenAI.Chat.ChatCompletionMessageToolCall[],
              })
            } else {
              messages.push({
                role: 'assistant',
                content: textParts.join('\n') || null,
              })
            }
          }
        }
      }

      const tools: OpenAI.Chat.ChatCompletionTool[] | undefined =
        params.tools.length > 0
          ? params.tools.map(t => ({
              type: 'function' as const,
              function: {
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
              },
            }))
          : undefined

      const stream = await openai.chat.completions.create(
        {
          model: params.model || config.defaultModel || 'gpt-4o',
          messages,
          tools,
          stream: true,
          max_tokens: params.maxOutputTokens,
          temperature: params.temperature,
        },
        { signal: params.signal },
      )

      let currentToolCallId = ''
      let currentToolCallName = ''
      let currentToolCallArgs = ''
      let messageId = ''
      const totalUsage: Usage = {
        inputTokens: 0,
        outputTokens: 0,
      }
      let stopReason = 'end_turn'
      let model = params.model

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0]
        if (!choice) continue

        if (!messageId && chunk.id) {
          messageId = chunk.id
          model = chunk.model || model
          yield { type: 'message_start', messageId, model }
        }

        const delta = choice.delta

        if (delta?.content) {
          yield { type: 'text_delta', text: delta.content }
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              if (currentToolCallId && currentToolCallName) {
                let input: Record<string, unknown> = {}
                try {
                  input = JSON.parse(currentToolCallArgs || '{}')
                } catch { /* partial parse fallback */ }
                yield {
                  type: 'tool_use_start',
                  id: currentToolCallId,
                  name: currentToolCallName,
                  input,
                }
              }
              currentToolCallId = tc.id
              currentToolCallName = tc.function?.name || ''
              currentToolCallArgs = tc.function?.arguments || ''
            } else {
              if (tc.function?.arguments) {
                currentToolCallArgs += tc.function.arguments
                yield {
                  type: 'tool_use_delta',
                  id: currentToolCallId,
                  partialInput: tc.function.arguments,
                }
              }
            }
          }
        }

        if (choice.finish_reason) {
          stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason
        }

        if (chunk.usage) {
          totalUsage.inputTokens = chunk.usage.prompt_tokens || 0
          totalUsage.outputTokens = chunk.usage.completion_tokens || 0
        }
      }

      if (currentToolCallId && currentToolCallName) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(currentToolCallArgs || '{}')
        } catch { /* fallback */ }
        yield {
          type: 'tool_use_start',
          id: currentToolCallId,
          name: currentToolCallName,
          input,
        }
      }

      yield { type: 'message_end', usage: totalUsage, stopReason }
    },
  }
}
