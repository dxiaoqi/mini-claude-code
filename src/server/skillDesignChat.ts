/**
 * 多轮「无工具」LLM 调用，供 Skill 设计向导使用
 */
import { createOpenAICompatibleClient } from '../api/client.js'
import { createAnthropicClient } from '../api/anthropicClient.js'
import { resolveApiConfig } from '../utils/config.js'
import type { Message, UserMessage, AssistantMessage } from '../types.js'

const SYSTEM = `You help the user design a **Blino skill**: a Markdown file under .blino/skills/ with optional YAML frontmatter (name, description, allowedTools).

- Reply in the same language the user uses (Chinese or English).
- In the first 1–2 turns, ask at most one focused question if the goal is unclear.
- When you have enough detail, in a reply you may end with a single fenced code block for the file:
  - Opening line must be exactly \`\`\`blino-skill
  - Inside: the full file content, including \`---\` frontmatter and body
  - Close with \`\`\`
- If you are not ready to output the file yet, do not use the blino-skill fence; just converse.`

/**
 * 一轮对话，追加到 history；返回本助手回复全文
 */
export async function runSkillDesignChat(
  projectRoot: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<{ text: string; error?: string }> {
  let api: Awaited<ReturnType<typeof resolveApiConfig>>
  try {
    api = await resolveApiConfig(projectRoot)
  } catch (e) {
    return { text: '', error: (e as Error).message }
  }
  let client: ReturnType<typeof createOpenAICompatibleClient> | ReturnType<typeof createAnthropicClient>
  try {
    if (api.provider === 'anthropic') {
      client = createAnthropicClient({
        apiKey: api.apiKey,
        baseURL: api.baseUrl,
        defaultModel: api.model,
      })
    } else {
      if (!api.baseUrl) {
        return { text: '', error: 'openaiBaseUrl is required in settings for OpenAI provider' }
      }
      client = createOpenAICompatibleClient({
        apiKey: api.apiKey,
        baseURL: api.baseUrl,
        defaultModel: api.model,
      })
    }
  } catch (e) {
    return { text: '', error: (e as Error).message }
  }

  const messages: Message[] = []
  for (const t of history) {
    if (t.role === 'user') {
      messages.push({ role: 'user', content: t.content } as UserMessage)
    } else {
      messages.push({ role: 'assistant', content: t.content } as AssistantMessage)
    }
  }
  if (messages.length === 0) {
    return { text: '', error: 'No messages' }
  }

  const stream = client.callModel({
    model: api.model,
    systemPrompt: [{ text: SYSTEM, cacheScope: null }],
    messages,
    tools: [],
    maxOutputTokens: 4096,
    temperature: 0.4,
  })

  let text = ''
  for await (const ev of stream) {
    if (ev.type === 'text_delta') {
      text += ev.text
    }
  }
  return { text }
}
