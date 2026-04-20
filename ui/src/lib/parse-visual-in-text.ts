/**
 * Extract <visual> tags and ```html/svg/threejs fences from a plain string into UI ContentBlocks.
 * Used when assistant text lives in `message.content` (Agent mode or history) without `message.blocks`.
 *
 * IMPORTANT: Do not strip the full raw string before splitting — visual inner HTML/SVG must stay intact.
 * Prose *outside* `<visual>` may use `stripSvgTextWrapperTags` (keeps SVG `<text x=…>`).
 */
import type { ContentBlock, VisualBlockType } from '@/lib/types'
import { stripSvgTextWrapperTags } from '@/lib/redacted-thinking'

const FENCE_RE = /```(html?|svg|threejs|javascript|js)\s*\n([\s\S]*?)(?:```|$)/gi

/**
 * @returns `null` if there is nothing to split (no visual markers), else block list (may be empty if only fragments).
 */
export function parseVisualBlocksFromText(raw: string): ContentBlock[] | null {
  if (!raw.includes('<visual') && !raw.includes('```')) return null

  const content = raw
  const result: ContentBlock[] = []
  let idCounter = 0
  const nextId = () => `v_${++idCounter}`

  const hasVisual = content.includes('<visual')
  const hasFence = content.includes('```')

  if (!hasVisual && !hasFence) return null

  let remaining = content
  let changed = false

  if (hasVisual) {
    while (remaining.length > 0) {
      const vStart = remaining.indexOf('<visual')
      if (vStart === -1) break
      const gtIdx = remaining.indexOf('>', vStart)
      if (gtIdx === -1) break
      const tagContent = remaining.slice(vStart, gtIdx + 1)
      const typeMatch = tagContent.match(/type\s*=\s*['"]([^'"]+)['"]/)
      if (!typeMatch) break
      const visualType = typeMatch[1]
      const closeTag = '</visual>'
      const vEnd = remaining.indexOf(closeTag, gtIdx)
      if (vEnd === -1) break
      const beforeText = stripSvgTextWrapperTags(remaining.slice(0, vStart))
      if (beforeText.trim()) {
        result.push({ kind: 'text', id: nextId(), content: beforeText, isStreaming: false })
      }
      const visualContent = remaining.slice(gtIdx + 1, vEnd).trim()
      const safeType = (['svg', 'html', 'threejs'].includes(visualType) ? visualType : 'html') as VisualBlockType
      result.push({ kind: 'visual', id: nextId(), visualType: safeType, content: visualContent, isComplete: true })
      remaining = remaining.slice(vEnd + closeTag.length)
      changed = true
    }
    if (changed) {
      const tail = stripSvgTextWrapperTags(remaining)
      if (tail.trim()) {
        result.push({ kind: 'text', id: nextId(), content: tail, isStreaming: false })
      }
      return result.length ? result : null
    }
  }

  if (hasFence) {
    FENCE_RE.lastIndex = 0
    let fenceChanged = false
    let fenceRemaining = content
    let m: RegExpExecArray | null
    while ((m = FENCE_RE.exec(fenceRemaining)) !== null) {
      const lang = m[1].toLowerCase()
      const code = m[2].trim()
      const vt = (lang === 'svg' ? 'svg' : lang === 'threejs' ? 'threejs' : 'html') as VisualBlockType
      const before = stripSvgTextWrapperTags(fenceRemaining.slice(0, m.index))
      if (before.trim()) {
        result.push({ kind: 'text', id: nextId(), content: before, isStreaming: false })
      }
      result.push({ kind: 'visual', id: nextId(), visualType: vt, content: code, isComplete: true })
      fenceRemaining = fenceRemaining.slice(m.index + m[0].length)
      FENCE_RE.lastIndex = 0
      fenceChanged = true
    }
    if (fenceChanged) {
      const tail = stripSvgTextWrapperTags(fenceRemaining)
      if (tail.trim()) {
        result.push({ kind: 'text', id: nextId(), content: tail, isStreaming: false })
      }
      return result.length ? result : null
    }
  }

  return null
}
