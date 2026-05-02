import Anthropic from '@anthropic-ai/sdk'
import type { MemoryEntry, MemoryCategory } from '../compact/sessionMemory.js'

const SYSTEM_PROMPT = `你是一个通用记忆提取器。分析输入，提取值得长期记住的信息。
分类规则：
- constraint：约束禁令。信号词：不能/禁止/必须/要求。ttlTurns:-1, imp:0.8~1.0
- fact：客观事实/数值/工具结果。信号词：结果是/找到/返回了。ttlTurns:10, imp:0.6~0.9
- preference：用户偏好风格。信号词：我喜欢/倾向于。ttlTurns:-1, imp:0.5~0.7
- progress：任务进度。信号词：完成了/下一步/正在。ttlTurns:5, imp:0.7~0.9
- entity：重要实体（人名/系统名/文件名）。ttlTurns:20, imp:0.4~0.7
不提取：闲聊、礼貌用语、思考过程、本轮已答的问题。
严格输出 JSON 数组，无其他文字，无内容时输出 []:
[{"category":"...","key":"snake_case英文","value":"内容","importance":0.85,"ttlTurns":-1}]`

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

interface RawEntry {
  category: MemoryCategory
  key: string
  value: string
  importance: number
  ttlTurns: number
}

export async function extractMemoriesFromTurn(
  userMsg: string,
  assistantMsg: string,
  turn: number,
  apiKey: string,
  baseURL?: string,
  model?: string,
): Promise<MemoryEntry[]> {
  try {
    const client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    })

    const content = `User: ${userMsg}\n\nAssistant: ${assistantMsg}`

    const response = await client.messages.create({
      model: model ?? 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    if (!text || text === '[]') return []

    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []

    const now = Date.now()
    return (parsed as RawEntry[])
      .filter(e => e && typeof e.category === 'string' && typeof e.key === 'string' && typeof e.value === 'string')
      .map(e => ({
        id: makeId(),
        category: e.category,
        key: e.key,
        value: String(e.value),
        importance: typeof e.importance === 'number' ? Math.min(1, Math.max(0, e.importance)) : 0.5,
        ttlTurns: typeof e.ttlTurns === 'number' ? e.ttlTurns : -1,
        createdTurn: turn,
        updatedAt: now,
      }))
  } catch {
    return []
  }
}
