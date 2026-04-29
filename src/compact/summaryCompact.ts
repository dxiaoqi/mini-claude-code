/**
 * summaryCompact.ts — LLM 摘要式上下文压缩
 *
 * 参考 Claude Code autoCompact 实现，当上下文接近模型窗口上限时：
 *   1. 保留最近 K 个完整轮次原文（messagesToKeep）
 *   2. 对更早的消息调 LLM 生成 9 节结构化摘要
 *   3. 组装 [user:摘要] + [messagesToKeep] 作为新上下文
 *
 * 触发阈值（模型感知）：
 *   effectiveWindow = contextWindow - min(maxOutput, 20_000)
 *   threshold       = effectiveWindow - BUFFER (13_000)
 */

import type { APIClient, Message, ContentBlock } from '../types.js'

// ─── 阈值常量（与 Claude Code 对齐）────────────────────────────────────────────

const BUFFER_TOKENS = 13_000
const RESERVED_FOR_SUMMARY = 20_000
const WARNING_BUFFER_TOKENS = 20_000

// ─── 模型上下文窗口查表 ──────────────────────────────────────────────────────────

function getContextWindow(model: string): number {
  const m = model.toLowerCase()
  if (m.includes('claude-3-5') || m.includes('claude-sonnet-4') || m.includes('claude-opus-4')) return 200_000
  if (m.includes('claude-3')) return 200_000
  if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 128_000
  if (m.includes('gpt-4')) return 8_192
  if (m.includes('gpt-3.5')) return 16_385
  if (m.includes('deepseek')) return 64_000
  if (m.includes('qwen') || m.includes('doubao')) return 32_000
  // 未知模型保守默认：32K
  return 32_000
}

function getMaxOutputTokens(model: string): number {
  const m = model.toLowerCase()
  if (m.includes('claude')) return 16_000
  return 8_000
}

export function getEffectiveContextWindow(model: string): number {
  const reservedForSummary = Math.min(getMaxOutputTokens(model), RESERVED_FOR_SUMMARY)
  return getContextWindow(model) - reservedForSummary
}

export function getAutoCompactThreshold(model: string): number {
  // Allow override via env var for testing (e.g. BLINO_COMPACT_THRESHOLD=2000)
  const override = parseInt(process.env.BLINO_COMPACT_THRESHOLD ?? '', 10)
  if (!isNaN(override) && override > 0) return override
  return getEffectiveContextWindow(model) - BUFFER_TOKENS
}

export function getWarningThreshold(model: string): number {
  // Warning fires 20k tokens before the compact threshold
  const override = parseInt(process.env.BLINO_COMPACT_THRESHOLD ?? '', 10)
  if (!isNaN(override) && override > 0) return Math.max(0, override - WARNING_BUFFER_TOKENS)
  return getAutoCompactThreshold(model) - WARNING_BUFFER_TOKENS
}

// ─── 压缩提示词（9 节，参考 Claude Code getCompactPrompt）───────────────────────

export function getCompactPrompt(customInstructions?: string): string {
  const base = `Your task is to create a comprehensive summary of the conversation so far, which will serve as the context for continuing the work in a new conversation window.

The summary MUST preserve ALL information critical for continuing the work without loss. Follow this 9-section structure:

<analysis>
Analyze what critical information must be preserved to allow seamless continuation.
</analysis>

<summary>
## 1. Primary Request & Intent
What was the user's original goal and overall objective? Include any constraints, preferences, or specific requirements mentioned.

## 2. Current Work State
What is the exact current state of the work? What was most recently being done? Be precise about where things stand.

## 3. Key Decisions & Reasoning
What important decisions were made and why? What approaches were chosen over alternatives?

## 4. Completed Work
What has been accomplished? For each completed item, include:
- File paths (exact paths, not relative)
- Key function/class names
- Critical code snippets if they affect future decisions
- Commands run and their outcomes

## 5. Pending Tasks
What still needs to be done? List specific remaining tasks in order of priority.

## 6. Technical Context & Architecture
Important technical context: dependencies chosen, architecture decisions, coding patterns, configuration details, API keys/endpoints used (obfuscated if sensitive).

## 7. Data, Observations & Results
Key data points, measurements, test results, API responses, or observations that affect the work.

## 8. Errors & Fixes
Problems encountered, their root causes, and how they were resolved. Any known remaining issues.

## 9. Key Patterns & Conventions
Important patterns, conventions, or constraints established during the session that must be followed in future work.
</summary>

CRITICAL REQUIREMENTS:
- Include exact file paths for all mentioned files
- Preserve specific function names, class names, and variable names
- Include error messages verbatim if they may recur
- Maintain the same programming language and style throughout
- The summary must be self-contained: someone reading only the summary should have everything needed to continue the work`

  if (customInstructions) {
    return `${base}\n\nAdditional instructions:\n${customInstructions}`
  }
  return base
}

// ─── 解析 LLM 摘要响应 ───────────────────────────────────────────────────────────

export function parseCompactResponse(response: string): string | null {
  // 提取 <summary>...</summary> 内容（跳过 <analysis> 块）
  const summaryMatch = response.match(/<summary>([\s\S]*?)<\/summary>/i)
  if (summaryMatch?.[1]) {
    return summaryMatch[1].trim()
  }
  // 如果模型没有严格遵守格式，尝试去掉 <analysis> 后用整体内容
  const withoutAnalysis = response.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim()
  if (withoutAnalysis.length > 100) {
    return withoutAnalysis
  }
  return null
}

// ─── messagesToKeep：保留最近 K 个完整轮次 ────────────────────────────────────────

/**
 * 找到"保留区"的起始索引：从末尾数 keepTurns 个 assistant 消息，
 * 然后向前找到它之前最近的 user 消息，作为 kept 的起点。
 * 确保 messagesToKeep 永远以 user 消息开头。
 */
function findKeepBoundary(messages: Message[], keepTurns: number): number {
  let assistantCount = 0
  let boundaryIdx = messages.length // 默认：不保留任何消息

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      assistantCount++
      if (assistantCount === keepTurns) {
        // 向前找到 assistant 之前的 user 消息
        let j = i - 1
        while (j >= 0 && messages[j].role !== 'user') {
          j--
        }
        // 若找到 user，从 user 处切；否则从 assistant 处切
        boundaryIdx = j >= 0 ? j : i
        break
      }
    }
  }

  return boundaryIdx
}

// ─── 生成摘要（调 API）──────────────────────────────────────────────────────────────

async function generateSummary(
  messagesToSummarize: Message[],
  apiClient: APIClient,
  model: string,
  customInstructions?: string,
): Promise<string | null> {
  // 构建用于摘要的消息：把要摘要的内容作为对话历史，再加摘要指令
  const historyText = messagesToSummarize
    .filter(m => m.role !== 'system')
    .map(m => {
      const role = m.role === 'user' ? 'Human' : 'Assistant'
      const content = typeof m.content === 'string'
        ? m.content
        : formatContentBlocks(m.content as ContentBlock[])
      return `${role}: ${content}`
    })
    .join('\n\n---\n\n')

  const compactPrompt = getCompactPrompt(customInstructions)

  const summaryMessages: Message[] = [
    {
      role: 'user',
      content: `Here is the conversation to summarize:\n\n<conversation>\n${historyText}\n</conversation>\n\n${compactPrompt}`,
    },
  ]

  try {
    let fullResponse = ''
    const stream = apiClient.callModel({
      model,
      systemPrompt: [{ text: 'You are a conversation summarizer. Create a comprehensive, structured summary that preserves all critical information for continuing the work.' }],
      messages: summaryMessages,
      tools: [],
      maxOutputTokens: RESERVED_FOR_SUMMARY,
    })

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        fullResponse += event.text
      }
    }

    return parseCompactResponse(fullResponse)
  } catch {
    return null
  }
}

function formatContentBlocks(blocks: ContentBlock[]): string {
  return blocks.map(block => {
    if (block.type === 'text') return block.text
    if (block.type === 'tool_use') {
      return `[Tool: ${block.name}]\nInput: ${JSON.stringify(block.input, null, 2)}`
    }
    if (block.type === 'tool_result') {
      const content = typeof block.content === 'string'
        ? block.content
        : (block.content as ContentBlock[]).map(b => 'text' in b ? b.text : '').join('\n')
      // 工具结果可能很长，截断以节省摘要 token
      return `[Tool Result]\n${content.slice(0, 2000)}${content.length > 2000 ? '\n...[truncated]' : ''}`
    }
    return '[image]'
  }).join('\n')
}

// ─── 主压缩函数 ────────────────────────────────────────────────────────────────────

export interface CompactionResult {
  /** 包含摘要的 user 消息 */
  summaryMessage: Message
  /** 保留的最近 K 轮完整消息 */
  messagesToKeep: Message[]
  /** 估算释放的 token 数 */
  tokensFreed: number
  strategy: 'summary'
  /** 摘要文本（供 session memory 存储） */
  summaryText: string
}

/**
 * 构建压缩后的完整 messages 数组。
 * 结构：[compactBoundary][summaryMessage][messagesToKeep]
 */
export function buildPostCompactMessages(result: CompactionResult): Message[] {
  const boundary: Message = {
    role: 'system',
    content: `[Context compacted. Previous conversation summarized above.]`,
    type: 'compact_boundary',
  }
  return [boundary, result.summaryMessage, ...result.messagesToKeep]
}

/**
 * 核心压缩入口：评估是否需要压缩，若需要则执行。
 *
 * @param messages       当前完整消息列表
 * @param apiClient      用于调用 LLM 生成摘要
 * @param model          当前模型名（用于计算阈值）
 * @param currentTokens  当前已知的 inputTokens（来自上轮 API 响应）
 * @param keepTurns      保留最近多少个完整轮次不压缩（默认 4）
 * @param customInstructions  自定义摘要指令（/compact 时可传入）
 */
export async function summaryCompactIfNeeded(
  messages: Message[],
  apiClient: APIClient,
  model: string,
  currentTokens: number,
  keepTurns = 4,
  customInstructions?: string,
  summaryPrefix?: string,
): Promise<{ messages: Message[]; result: CompactionResult | null; warning: boolean }> {
  const threshold = getAutoCompactThreshold(model)
  const warningThreshold = getWarningThreshold(model)

  if (currentTokens < warningThreshold) {
    return { messages, result: null, warning: false }
  }

  if (currentTokens < threshold) {
    return { messages, result: null, warning: true }
  }

  // 触发压缩
  const keepBoundary = findKeepBoundary(messages, keepTurns)

  // 如果没有足够的旧消息可以压缩（全是最近的），跳过
  if (keepBoundary <= 0) {
    return { messages, result: null, warning: true }
  }

  const messagesToSummarize = messages.slice(0, keepBoundary)
  const messagesToKeep = messages.slice(keepBoundary)

  // 生成摘要
  const summaryText = await generateSummary(messagesToSummarize, apiClient, model, customInstructions)
  if (!summaryText) {
    // 摘要生成失败，不压缩（避免信息丢失）
    return { messages, result: null, warning: true }
  }

  // 估算释放的 token（用字符数粗估）
  const freedChars = messagesToSummarize.reduce((sum, m) => {
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return sum + c.length
  }, 0)
  const tokensFreed = Math.ceil(freedChars * 0.25)

  const summaryMessage: Message = {
    role: 'user',
    content: summaryPrefix
      ? `${summaryPrefix}\n\n[Context Summary — Previous Conversation]\n\n${summaryText}\n\n[End of Summary — Continuing from current state]`
      : `[Context Summary — Previous Conversation]\n\n${summaryText}\n\n[End of Summary — Continuing from current state]`,
  }

  const compactionResult: CompactionResult = {
    summaryMessage,
    messagesToKeep,
    tokensFreed,
    strategy: 'summary',
    summaryText,
  }

  const newMessages = buildPostCompactMessages(compactionResult)

  return { messages: newMessages, result: compactionResult, warning: false }
}
