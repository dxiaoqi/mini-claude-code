/**
 * Thinking wrappers inside assistant text (reasoning models):
 * - `redacted_thinking` blocks (OpenAI / skill-pack style)
 * - `think` blocks (generic XML)
 * Content inside belongs in the 💭 think affordance, not main `ProseMarkdown` body.
 */

const RT_OPEN = '<' + 'redacted' + '_' + 'thinking' + '>'
const RT_CLOSE = '<' + '/' + 'redacted' + '_' + 'thinking' + '>'
const T_OPEN = '<' + ['t', 'h', 'i', 'n', 'k'].join('') + '>'
const T_CLOSE = '<' + '/' + ['t', 'h', 'i', 'n', 'k'].join('') + '>'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const BLOCK_RE_REDACTED = new RegExp(`${escapeRe(RT_OPEN)}([\\s\\S]*?)${escapeRe(RT_CLOSE)}`, 'gi')
const BLOCK_RE_THINK = new RegExp(`${escapeRe(T_OPEN)}([\\s\\S]*?)${escapeRe(T_CLOSE)}`, 'gi')

const OPEN_TAGS = [RT_OPEN, T_OPEN] as const

/**
 * Remove mistaken LLM prose wrappers `<text>…</text>` (no attributes).
 * Preserves real SVG `<text x="…" …>` which always has `=` in the opening tag.
 */
export function stripSvgTextWrapperTags(s: string): string {
  return s
    .replace(/<text([^>]*)>([\s\S]*?)<\/text>/gi, (full, attrs: string, inner: string) => {
      if (/=/.test(String(attrs))) return full
      return String(inner)
    })
    .trim()
}

/**
 * Streaming-safe variant: strips complete `<text>…</text>` pairs AND bare
 * opening `<text>` tags that haven't been closed yet (mid-stream).
 * SVG `<text x="…">` tags (with attributes) are left untouched.
 */
export function stripSvgTextWrapperTagsStreaming(s: string): string {
  // First strip complete pairs
  let out = s.replace(/<text([^>]*)>([\s\S]*?)<\/text>/gi, (full, attrs: string, inner: string) => {
    if (/=/.test(String(attrs))) return full
    return String(inner)
  })
  // Then strip any remaining bare opening tag (no attributes, not yet closed)
  out = out.replace(/<text>/gi, '')
  return out
}

function removeCompleteBlocks(s: string, thinkingParts: string[]): string {
  let out = s.replace(BLOCK_RE_REDACTED, (_, inner: string) => {
    const t = String(inner).trim()
    if (t) thinkingParts.push(t)
    return ''
  })
  out = out.replace(BLOCK_RE_THINK, (_, inner: string) => {
    const t = String(inner).trim()
    if (t) thinkingParts.push(t)
    return ''
  })
  return out
}

/**
 * Split complete + trailing-unclosed thinking blocks from model output.
 * - `publicText`: safe to show as normal assistant text / parse for `<visual>`.
 * - `thinking`: cumulative inner content (for 💭 bubble); unclosed tail streams here.
 */
export function splitRedactedThinking(raw: string): { publicText: string; thinking: string } {
  const thinkingParts: string[] = []
  let s = removeCompleteBlocks(raw, thinkingParts)

  let best: { idx: number; tag: string } | null = null
  for (const tag of OPEN_TAGS) {
    const idx = s.lastIndexOf(tag)
    if (idx !== -1 && (!best || idx >= best.idx)) best = { idx, tag }
  }
  if (best) {
    const after = s.slice(best.idx + best.tag.length)
    thinkingParts.push(after)
    s = s.slice(0, best.idx)
  }

  return {
    publicText: s,
    thinking: thinkingParts.join('\n\n'),
  }
}

/** For committed text blocks: visible markdown + extracted thinking (incl. SVG text fix). */
export function thinkingFromAssistantText(raw: string): { text: string; thinking: string } {
  const { publicText, thinking } = splitRedactedThinking(raw)
  return { text: stripSvgTextWrapperTags(publicText), thinking }
}

/** Remove thinking wrappers from all text blocks; merge extracted thinking into one string. */
export function stripThinkingFromContentBlocks<T extends { kind: string; content: string }>(
  blocks: T[],
): { blocks: T[]; thinking: string } {
  const thinkingParts: string[] = []
  const next = blocks.map(b => {
    if (b.kind !== 'text') return b
    const { text, thinking } = thinkingFromAssistantText(b.content)
    if (thinking) thinkingParts.push(thinking)
    return { ...b, content: text } as T
  })
  return { blocks: next, thinking: thinkingParts.join('\n\n') }
}
