'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { ArrowUp, Loader2, Download, Image as ImageIcon, Sun, Moon } from 'lucide-react'
import { MessageItem, type ChatMessage, type InProgressArtifact, type ToolCallItem } from '@/components/MessageItem'
import { type WidgetState } from '@/components/WidgetRenderer'
import { type PlanPhase } from '@/components/PlanProgress'
import { type ContentBlock } from '@/lib/types'
import {
  exportConversationJson,
  exportConversationAsImage,
  type ExportableChatMessage,
} from '@/lib/export-image'
import { ModeToggle, type AppMode } from '@/components/ModeToggle'
import { PermissionDialog, type PermissionRequest } from '@/components/PermissionDialog'

const LINO_URL = process.env.NEXT_PUBLIC_LINO_URL || 'http://localhost:3001'

interface StreamMeta { conversationId?: string; artifactId?: string; turnId?: string; sessionId?: string }

let msgCounter = 0
function nextId() { return `msg_${++msgCounter}` }

let splitBlockCounter = 0
/**
 * Post-processing: scan each text block for:
 *  1. Embedded <visual type="...">...</visual> sequences (parser boundary edge case)
 *  2. Markdown fenced code blocks (```html / ```svg / ```threejs) — model compliance fallback
 * Both are promoted to proper visual blocks so the user sees a rendered component.
 */
/** Strip <text>…</text> wrapper tags the model sometimes emits (anywhere in content). */
function stripTextTags(s: string): string {
  return s
    .replace(/<text[^>]*>/gi, '')   // remove any <text> opening tag (with or without attrs)
    .replace(/<\/text>/gi, '')       // remove all </text> closing tags
    .trim()
}

function extractEmbeddedVisuals(blocks: ContentBlock[]): ContentBlock[] {
  const FENCE_RE = /```(html?|svg|threejs|javascript|js)\s*\n([\s\S]*?)(?:```|$)/gi

  const result: ContentBlock[] = []
  for (const block of blocks) {
    if (block.kind !== 'text') { result.push(block); continue }

    // Strip <text>...</text> wrapper tags the model sometimes outputs literally
    const content = stripTextTags(block.content)
    const hasVisual = content.includes('<visual')
    const hasFence = content.includes('```')

    // Fast path: nothing to extract
    if (!hasVisual && !hasFence) {
      if (content.trim()) result.push({ ...block, content })
      continue
    }

    // ── 1. Extract <visual type="...">…</visual> tags ──────────────────────
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
        const beforeText = stripTextTags(remaining.slice(0, vStart))
        if (beforeText.trim()) result.push({ kind: 'text', id: `split_${++splitBlockCounter}`, content: beforeText, isStreaming: false })
        const visualContent = remaining.slice(gtIdx + 1, vEnd).trim()
        const safeType = (['svg', 'html', 'threejs'].includes(visualType) ? visualType : 'html') as import('@/lib/types').VisualBlockType
        result.push({ kind: 'visual', id: `split_${++splitBlockCounter}`, visualType: safeType, content: visualContent, isComplete: true })
        remaining = remaining.slice(vEnd + closeTag.length)
        changed = true
      }
      // ✅ Fix: use `if (changed)` not `if (remaining && changed)`
      // When content ends with </visual>, remaining='' but we still need to skip the original block.
      if (changed) {
        const tail = stripTextTags(remaining)
        if (tail.trim()) result.push({ kind: 'text', id: `split_${++splitBlockCounter}`, content: tail, isStreaming: false })
        continue
      }
    }

    // ── 2. Extract ```html/svg/threejs fences (model compliance fallback) ──
    if (!changed && hasFence) {
      FENCE_RE.lastIndex = 0
      let fenceChanged = false
      let fenceRemaining = remaining
      let m: RegExpExecArray | null
      while ((m = FENCE_RE.exec(fenceRemaining)) !== null) {
        const lang = m[1].toLowerCase()
        const code = m[2].trim()
        const vt = (lang === 'svg' ? 'svg' : lang === 'threejs' ? 'threejs' : 'html') as import('@/lib/types').VisualBlockType
        const before = stripTextTags(fenceRemaining.slice(0, m.index))
        if (before.trim()) result.push({ kind: 'text', id: `split_${++splitBlockCounter}`, content: before, isStreaming: false })
        result.push({ kind: 'visual', id: `split_${++splitBlockCounter}`, visualType: vt, content: code, isComplete: true })
        fenceRemaining = fenceRemaining.slice(m.index + m[0].length)
        FENCE_RE.lastIndex = 0
        fenceChanged = true
      }
      if (fenceChanged) {
        const tail = stripTextTags(fenceRemaining)
        if (tail.trim()) result.push({ kind: 'text', id: `split_${++splitBlockCounter}`, content: tail, isStreaming: false })
        continue
      }
    }

    if (content.trim()) result.push({ ...block, content })
  }
  return result
}

// ─── Export action state ──────────────────────────────────────────────────────

type ExportBtnState = 'idle' | 'loading' | 'done'

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [mode, setMode] = useState<AppMode>('agent')
  const modeRef = useRef<AppMode>('agent')
  useEffect(() => { modeRef.current = mode }, [mode])

  // Separate session refs per mode so each has its own system prompt context
  const agentSessionIdRef = useRef<string | null>(null)
  const artifactsSessionIdRef = useRef<string | null>(null)
  // Pending session creation Promise — avoids blocking the first message
  const artifactsSessionPromiseRef = useRef<Promise<void> | null>(null)

  // Eagerly create Artifacts session in background when mode switches to 'artifacts'
  useEffect(() => {
    if (mode !== 'artifacts' || artifactsSessionIdRef.current || artifactsSessionPromiseRef.current) return
    artifactsSessionPromiseRef.current = (async () => {
      let systemPromptAddendum: string | undefined
      try {
        const ctxRes = await fetch(`${LINO_URL}/api/visual-context`)
        if (ctxRes.ok) {
          const data = await ctxRes.json()
          systemPromptAddendum = data.content ?? undefined
        }
      } catch { /* skip */ }
      try {
        const sessRes = await fetch(`${LINO_URL}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(systemPromptAddendum ? { systemPromptAddendum } : {}),
        })
        if (sessRes.ok) {
          const d = await sessRes.json()
          artifactsSessionIdRef.current = d.session?.id ?? null
        }
      } catch { /* skip */ }
    })()
  }, [mode])

  // Artifacts mode real-time streaming state machine
  const artifactsStreamRef = useRef({
    inVisual: false,
    visualType: 'svg' as string,
    textAccum: '',      // text accumulating before/after a visual
    visualAccum: '',    // SVG/HTML content accumulating inside a visual
    committed: [] as ContentBlock[],
    textCount: 0,
    visualCount: 0,
  })
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null)

  // In-progress artifact state (cleared and committed to message on plan.completed)
  const [inProgressWidgets, setInProgressWidgets] = useState<WidgetState[]>([])
  const [inProgressPlanPhases, setInProgressPlanPhases] = useState<PlanPhase[]>([])
  const [inProgressCurrentPhaseId, setInProgressCurrentPhaseId] = useState<string | null>(null)
  const [inProgressIsTransition, setInProgressIsTransition] = useState(false)
  const [inProgressTransitionMessage, setInProgressTransitionMessage] = useState('')
  const [inProgressThinkText, setInProgressThinkText] = useState('')
  const [inProgressStatusMessage, setInProgressStatusMessage] = useState('')

  // ── Visual V2 block state ─────────────────────────────────────────────────
  // Blocks are built in-progress during streaming, then committed to the message
  const [inProgressBlocks, setInProgressBlocks] = useState<ContentBlock[]>([])
  const blockCounterRef = useRef(0)

  // Export states
  const [jsonExportState, setJsonExportState] = useState<ExportBtnState>('idle')
  const [imgExportState, setImgExportState] = useState<ExportBtnState>('idle')

  // Refs
  const messagesRootRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const metaRef = useRef<StreamMeta>({})
  const abortRef = useRef<AbortController | null>(null)
  const currentAssistantMsgIdRef = useRef<string | null>(null)
  const widgetCountRef = useRef(0)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, inProgressWidgets.length])

  // Auto-focus the input box after the AI finishes responding
  useEffect(() => {
    if (!isLoading) {
      textareaRef.current?.focus()
    }
  }, [isLoading])

  // Ref always pointing to the latest handleSubmit — updated on every render below.
  const handleSubmitRef = useRef<(text?: string) => void>(() => {})

  // ─── sendPrompt from visual iframes ────────────────────────────────────────
  // VisualRenderer calls onSendPrompt → MessageItem dispatches a window message
  // → here we catch it and submit directly (no async state-round-trip needed).
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'send-prompt') return
      const text = String(e.data.text ?? '').trim()
      if (!text) return
      setInput(text)               // populate the input box visually
      handleSubmitRef.current(text) // submit immediately with the override text
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // ─── Theme toggle ──────────────────────────────────────────────────────────

  const toggleTheme = () => {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      return next
    })
  }

  // ─── Conversation export ───────────────────────────────────────────────────

  const handleJsonExport = () => {
    if (!messages.length) return
    exportConversationJson(messages as ExportableChatMessage[])
    setJsonExportState('done')
    setTimeout(() => setJsonExportState('idle'), 2000)
  }

  const handleImgExport = async () => {
    if (!messagesRootRef.current || !messages.length) return
    setImgExportState('loading')
    try {
      await exportConversationAsImage(messagesRootRef.current, messages as ExportableChatMessage[])
      setImgExportState('done')
    } catch { /* ignore */ }
    setTimeout(() => setImgExportState('idle'), 2000)
  }

  // ─── Widget helpers ────────────────────────────────────────────────────────

  const upsertInProgressWidget = useCallback((id: string, update: Partial<WidgetState> | ((prev: WidgetState) => WidgetState)) => {
    setInProgressWidgets(prev => {
      const idx = prev.findIndex(w => w.id === id)
      if (idx === -1) return prev
      const old = prev[idx]
      const next = typeof update === 'function' ? update(old) : { ...old, ...update }
      return [...prev.slice(0, idx), next, ...prev.slice(idx + 1)]
    })
  }, [])

  // ─── Reset in-progress state ──────────────────────────────────────────────

  const resetInProgress = useCallback(() => {
    setInProgressWidgets([])
    setInProgressPlanPhases([])
    setInProgressCurrentPhaseId(null)
    setInProgressIsTransition(false)
    setInProgressTransitionMessage('')
    setInProgressThinkText('')
    setInProgressStatusMessage('')
    setInProgressBlocks([])
    widgetCountRef.current = 0
    blockCounterRef.current = 0
    artifactsStreamRef.current = {
      inVisual: false, visualType: 'svg',
      textAccum: '', visualAccum: '',
      committed: [], textCount: 0, visualCount: 0,
    }
  }, [])

  // ─── Message helpers ───────────────────────────────────────────────────────

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const full: ChatMessage = { ...msg, id: nextId(), timestamp: Date.now() }
    setMessages(prev => [...prev, full])
    return full.id
  }, [])

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m))
  }, [])

  // ─── Stream event processor (unified UIEvent format) ─────────────────────

  const processEvent = useCallback((raw: string) => {
    let event: Record<string, unknown>
    try { event = JSON.parse(raw) } catch { return }

    // Extract metadata (Visual mode includes these in every event)
    if (event.conversationId) metaRef.current.conversationId = event.conversationId as string
    if (event.artifactId) metaRef.current.artifactId = event.artifactId as string
    if (event.turnId) metaRef.current.turnId = event.turnId as string
    if (event.sessionId) metaRef.current.sessionId = event.sessionId as string

    const type = event.type as string

    switch (type) {
      // ── Common ────────────────────────────────────────────────────────────

      case 'status':
        setInProgressStatusMessage((event.message as string) || '')
        break

      // ── Agent / Artifacts — Text streaming ───────────────────────────────

      case 'text.delta': {
        const msgId = currentAssistantMsgIdRef.current
        const chunk = event.text as string
        if (!msgId) break

        if (modeRef.current === 'artifacts') {
          // Real-time state machine: detect <visual type="..."> / </visual> boundaries
          // and render each visual block as soon as it completes.
          const s = artifactsStreamRef.current

          if (!s.inVisual) {
            s.textAccum += chunk

            // Detect opening <visual type="..."> tag (may arrive across multiple chunks)
            const visualOpenIdx = s.textAccum.indexOf('<visual')
            if (visualOpenIdx !== -1) {
              const gtIdx = s.textAccum.indexOf('>', visualOpenIdx)
              if (gtIdx !== -1) {
                // Full opening tag received — commit text before it, start visual
                const tag = s.textAccum.slice(visualOpenIdx, gtIdx + 1)
                const typeMatch = tag.match(/type\s*=\s*['"]([^'"]+)['"]/)
                if (typeMatch) {
                  const beforeText = stripTextTags(s.textAccum.slice(0, visualOpenIdx))
                  if (beforeText.trim()) {
                  console.log('[art] commit text before visual, len:', beforeText.length, '| preview:', beforeText.slice(0, 60))
                  s.committed.push({
                    kind: 'text',
                    id: `art_t${++s.textCount}`,
                    content: beforeText,
                    isStreaming: false,
                  })
                  }
                  s.visualType = typeMatch[1]
                  s.visualAccum = s.textAccum.slice(gtIdx + 1)
                  s.textAccum = ''
                  s.inVisual = true
                  // Show skeleton for the visual being built
                  const skeletonId = `art_v${s.visualCount + 1}`
                  setInProgressBlocks([
                    ...s.committed,
                    { kind: 'visual', id: skeletonId, visualType: s.visualType as import('@/lib/types').VisualBlockType, content: '', isComplete: false },
                  ])
                }
              }
              // else: tag incomplete, wait for more chunks
            } else {
              // Pure text — update streaming text block
              const displayText = stripTextTags(s.textAccum)
              setInProgressBlocks([
                ...s.committed,
                ...(displayText.trim() ? [{
                  kind: 'text' as const,
                  id: 'art_streaming',
                  content: displayText,
                  isStreaming: true,
                }] : []),
              ])
            }
          } else {
            // Inside a visual block — accumulate content
            s.visualAccum += chunk
            const closeIdx = s.visualAccum.indexOf('</visual>')
            if (closeIdx !== -1) {
              // Visual complete — commit it
              const visualContent = s.visualAccum.slice(0, closeIdx).trim()
              const afterVisual = s.visualAccum.slice(closeIdx + '</visual>'.length)
              s.committed.push({
                kind: 'visual',
                id: `art_v${++s.visualCount}`,
                visualType: s.visualType as import('@/lib/types').VisualBlockType,
                content: visualContent,
                isComplete: true,
              })
              s.inVisual = false
              s.visualAccum = ''
              s.textAccum = afterVisual
              console.log('[art] visual committed, id:', `art_v${s.visualCount}`, '| content len:', visualContent.length, '| committed total:', s.committed.length)
              setInProgressBlocks([...s.committed])
            }
            // While accumulating visual, don't update UI (avoid iframe thrashing)
          }
        } else {
          // Agent mode: append directly to message content
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, content: m.content + chunk, isStreaming: true } : m
          ))
        }
        break
      }

      // ── Think block (both modes) ──────────────────────────────────────────

      case 'think.start':
        // Think bubble opens; thinkText will be populated by think.delta
        break

      case 'think.delta':
        setInProgressThinkText(prev => prev + (event.text as string))
        break

      case 'think.end':
        // Think bubble closes; thinkText stays for display
        break

      // ── Agent mode — Tools ────────────────────────────────────────────────

      case 'tool.start': {
        const msgId = currentAssistantMsgIdRef.current
        if (msgId) {
          setMessages(prev => prev.map(m => {
            if (m.id !== msgId) return m
            const toolCall: ToolCallItem = {
              id: event.id as string,
              name: event.name as string,
              input: event.input as Record<string, unknown>,
              status: 'running',
            }
            return { ...m, toolCalls: [...(m.toolCalls || []), toolCall] }
          }))
        }
        break
      }

      case 'tool.result': {
        const msgId = currentAssistantMsgIdRef.current
        if (msgId) {
          setMessages(prev => prev.map(m => {
            if (m.id !== msgId) return m
            const updated = (m.toolCalls || []).map(t =>
              t.id === (event.toolUseId as string)
                ? { ...t, status: 'done' as const, result: event.result, isError: event.isError as boolean | undefined }
                : t
            )
            return { ...m, toolCalls: updated }
          }))
        }
        break
      }

      // ── Agent mode — Message lifecycle ────────────────────────────────────

      case 'message.start':
        setInProgressStatusMessage(`${event.model || ''}`)
        break

      case 'turn.complete': {
        // INTERMEDIATE SIGNAL — not final completion, agent may continue with more tool rounds.
        const turnCount = event.turnCount as number | undefined
        console.log('[turn.complete] intermediate turn done, turnCount:', turnCount, '| mode:', modeRef.current)
        if (turnCount !== undefined) {
          setInProgressStatusMessage(`第 ${turnCount} 轮完成，继续中…`)
          setTimeout(() => setInProgressStatusMessage(''), 1200)
        }
        break
      }

      case 'done': {
        // TRUE COMPLETION — sent by server's finally block after runAgentLoop returns.
        const msgId = currentAssistantMsgIdRef.current
        const mode = modeRef.current

        console.group('[done] Agent run complete')
        console.log('mode:', mode, '| msgId:', msgId)

        if (mode === 'artifacts') {
          const s = artifactsStreamRef.current
          let finalBlocks: ContentBlock[] = [...s.committed]

          console.log('state machine snapshot:', {
            inVisual: s.inVisual,
            visualType: s.visualType,
            committedCount: s.committed.length,
            textAccumLen: s.textAccum.length,
            visualAccumLen: s.visualAccum.length,
            textAccumPreview: s.textAccum.slice(0, 120),
          })

          const remainingText = stripTextTags(s.inVisual ? s.visualAccum : s.textAccum)
          console.log('remainingText (after stripTextTags):', remainingText.slice(0, 120), '| len:', remainingText.length)

          if (s.inVisual && remainingText.trim()) {
            finalBlocks.push({
              kind: 'visual',
              id: `art_v${++s.visualCount}`,
              visualType: s.visualType as import('@/lib/types').VisualBlockType,
              content: remainingText,
              isComplete: true,
            })
          } else if (!s.inVisual && remainingText.trim()) {
            finalBlocks.push({ kind: 'text', id: `art_t${++s.textCount}`, content: remainingText, isStreaming: false })
          }

          console.log('finalBlocks from state machine:', finalBlocks.map(b => ({ kind: b.kind, id: b.id, len: b.kind === 'text' ? b.content.length : b.content.length })))

          setInProgressBlocks(currentBlocks => {
            console.log('inProgressBlocks at done:', currentBlocks.map(b => ({ kind: b.kind, id: b.id, len: b.content.length, isStreaming: (b as { isStreaming?: boolean }).isStreaming })))

            const blocksToCommit = finalBlocks.length > 0
              ? finalBlocks
              : currentBlocks.length > 0
                ? extractEmbeddedVisuals(currentBlocks.map(b => b.kind === 'text' ? { ...b, isStreaming: false } : b))
                : []

            console.log('blocksToCommit:', blocksToCommit.map(b => ({ kind: b.kind, id: b.id, len: b.content.length })), '| msgId:', msgId)

            if (msgId && blocksToCommit.length > 0) {
              setMessages(prev => {
                const updated = prev.map(m =>
                  m.id === msgId ? { ...m, content: '', isStreaming: false, blocks: blocksToCommit, artifactComplete: true } : m
                )
                const target = updated.find(m => m.id === msgId)
                console.log('setMessages result for msgId:', msgId, '→ blocks:', target?.blocks?.length, '| content:', target?.content?.slice(0, 60))
                return updated
              })
            } else if (msgId) {
              console.warn('[done] No blocks to commit — marking isStreaming=false only')
              setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isStreaming: false } : m))
            } else {
              console.error('[done] msgId is null — cannot update message!')
            }
            return []
          })
        } else {
          // Agent mode
          setInProgressBlocks(currentBlocks => {
            console.log('[done/agent] inProgressBlocks:', currentBlocks.length, '| msgId:', msgId)
            if (msgId && currentBlocks.length > 0) {
              const committed = extractEmbeddedVisuals(
                currentBlocks.map(b => b.kind === 'text' ? { ...b, isStreaming: false } : b)
              )
              console.log('[done/agent] committing blocks:', committed.length)
              setMessages(prev => prev.map(m =>
                m.id === msgId ? { ...m, content: '', isStreaming: false, blocks: committed, artifactComplete: true } : m
              ))
            } else if (msgId) {
              console.log('[done/agent] no inProgressBlocks, marking done')
              setMessages(prev => prev.map(m =>
                m.id === msgId ? { ...m, isStreaming: false } : m
              ))
            }
            return []
          })
        }

        setIsLoading(false)
        setInProgressStatusMessage('')
        console.groupEnd()
        break
      }

      // ── Agent mode — Permission ───────────────────────────────────────────

      case 'permission.request': {
        setPermissionRequest({
          requestId: event.requestId as string,
          toolName: event.toolName as string,
          input: event.input as Record<string, unknown>,
          message: event.message as string,
          riskLevel: event.riskLevel as string,
        })
        break
      }

      // ── Error ─────────────────────────────────────────────────────────────

      case 'error.occurred': {
        const msgId = currentAssistantMsgIdRef.current
        setIsLoading(false)
        setInProgressStatusMessage('')
        if (msgId) updateMessage(msgId, { content: `⚠ 出错: ${event.message}`, isStreaming: false })
        resetInProgress()
        break
      }

      // ── Visual mode — Conversational reply ────────────────────────────────

      case 'conversational.reply': {
        const text = event.text as string
        const done = event.done as boolean
        const msgId = currentAssistantMsgIdRef.current
        if (text && msgId) {
          setMessages(prev => prev.map(m =>
            m.id === msgId ? { ...m, content: m.content + text, isStreaming: !done } : m
          ))
        }
        if (done) {
          setIsLoading(false)
          setInProgressStatusMessage('')
          if (msgId) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isStreaming: false } : m))
        }
        break
      }

      // ── Visual mode — Plan / Phase ────────────────────────────────────────

      case 'plan.create': {
        const plan = event.plan as { phases: Array<{ id: string; goal: string }> }
        if (plan?.phases) {
          setInProgressPlanPhases(plan.phases.map(p => ({ id: p.id, goal: p.goal, status: 'pending' as const })))
        }
        break
      }

      case 'phase.start': {
        const id = event.id as string
        setInProgressCurrentPhaseId(id)
        setInProgressIsTransition(false)
        setInProgressPlanPhases(prev => prev.map(p => p.id === id ? { ...p, status: 'running' } : p))
        break
      }

      case 'phase.transition':
        setInProgressIsTransition(true)
        setInProgressTransitionMessage((event.message as string) || '正在检查…')
        break

      case 'critic.thinking':
        setInProgressTransitionMessage('检查中…')
        break

      case 'phase.complete':
        setInProgressPlanPhases(prev => prev.map(p => p.id === (event.id as string) ? { ...p, status: 'done' } : p))
        setInProgressIsTransition(false)
        break

      case 'phase.abandon':
        setInProgressPlanPhases(prev => prev.map(p => p.id === (event.id as string) ? { ...p, status: 'abandoned' } : p))
        break

      // ── Visual mode — Widgets ─────────────────────────────────────────────

      case 'widget.open': {
        const { id, widgetType, title } = event as { id: string; widgetType?: string; title?: string }
        widgetCountRef.current++
        setInProgressWidgets(prev => {
          if (prev.some(w => w.id === id)) return prev
          return [...prev, { id, type: widgetType || 'markdown', title, content: '', isStreaming: true }]
        })
        break
      }

      case 'widget.delta': {
        const { id, text } = event as { id: string; text: string }
        upsertInProgressWidget(id, w => ({ ...w, content: w.content + text }))
        break
      }

      case 'widget.close': {
        const { id, partial } = event as { id: string; partial?: boolean }
        upsertInProgressWidget(id, w => ({ ...w, isStreaming: false, partial: partial || false }))
        break
      }

      // ── Visual mode — plan.complete: commit widgets ───────────────────────

      case 'plan.complete': {
        const msgId = currentAssistantMsgIdRef.current
        const count = widgetCountRef.current

        setInProgressWidgets(currentWidgets => {
          setInProgressPlanPhases(currentPhases => {
            setInProgressThinkText(currentThinkText => {
              if (msgId) {
                setMessages(prev => prev.map(m =>
                  m.id === msgId ? {
                    ...m,
                    content: count > 0 ? '' : '生成完成',
                    isStreaming: false,
                    widgets: [...currentWidgets],
                    planPhases: [...currentPhases],
                    thinkText: currentThinkText,
                    artifactComplete: true,
                  } : m
                ))
              }
              return currentThinkText
            })
            return currentPhases
          })
          return currentWidgets
        })

        setIsLoading(false)
        setInProgressStatusMessage('')
        setInProgressIsTransition(false)
        setInProgressCurrentPhaseId(null)
        setTimeout(resetInProgress, 100)
        break
      }

      // ── Visual V2 block events ────────────────────────────────────────────

      case 'block.text_start': {
        const id = `b${++blockCounterRef.current}`
        setInProgressBlocks(prev => [...prev, { kind: 'text', id, content: '', isStreaming: true }])
        break
      }
      case 'block.text_delta': {
        const text = event.text as string
        setInProgressBlocks(prev => {
          if (!prev.length) return prev
          const last = prev[prev.length - 1]
          if (last.kind !== 'text') return prev
          return [...prev.slice(0, -1), { ...last, content: last.content + text }]
        })
        break
      }
      case 'block.text_end': {
        setInProgressBlocks(prev => {
          if (!prev.length) return prev
          const last = prev[prev.length - 1]
          if (last.kind !== 'text') return prev
          return [...prev.slice(0, -1), { ...last, isStreaming: false }]
        })
        break
      }
      case 'block.visual_start': {
        const id = `b${++blockCounterRef.current}`
        const visualType = (event.visualType as string) || 'html'
        setInProgressBlocks(prev => [...prev, {
          kind: 'visual', id,
          visualType: visualType as ContentBlock extends { kind: 'visual' } ? ContentBlock['visualType'] : never,
          content: '',
          isComplete: false,
        }])
        break
      }
      case 'block.visual': {
        const content = event.content as string
        const vt = event.visualType as string
        setInProgressBlocks(prev => {
          for (let i = prev.length - 1; i >= 0; i--) {
            const b = prev[i]
            if (b.kind === 'visual' && !b.isComplete) {
              const updated = [...prev]
              updated[i] = { ...b, content, isComplete: true, visualType: (vt || b.visualType) as ContentBlock extends { kind: 'visual' } ? ContentBlock['visualType'] : never }
              return updated
            }
          }
          return prev
        })
        break
      }
    }
  }, [upsertInProgressWidget, updateMessage, resetInProgress])

  // ─── Submit ────────────────────────────────────────────────────────────────

  const streamSSE = useCallback(async (url: string, body: Record<string, unknown>, signal: AbortSignal) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data && data !== '[DONE]') processEvent(data)
        }
      }
    }
  }, [processEvent])

  const handleSubmit = useCallback(async (overrideText?: string) => {
    const userText = (overrideText ?? input).trim()
    if (!userText || isLoading) return
    // Ensure modeRef is always in sync before processing events for this turn
    modeRef.current = mode
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    addMessage({ role: 'user', content: userText })
    const assistantMsgId = addMessage({ role: 'assistant', content: '', isStreaming: true })
    currentAssistantMsgIdRef.current = assistantMsgId

    resetInProgress()
    setInProgressStatusMessage('连接中…')
    setIsLoading(true)

    try {
      if (mode === 'agent' || mode === 'artifacts') {
        // ── Agent / Artifacts mode: directly connect to lino HTTP server ─
        const sessionRef = mode === 'agent' ? agentSessionIdRef : artifactsSessionIdRef

        if (!sessionRef.current) {
          if (mode === 'artifacts' && artifactsSessionPromiseRef.current) {
            // Session is being created in the background — await it instead of re-fetching
            await artifactsSessionPromiseRef.current
          } else {
            // Agent mode or fallback: create session on-demand (no addendum needed)
            const sessRes = await fetch(`${LINO_URL}/api/sessions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            })
            if (sessRes.ok) {
              const sessData = await sessRes.json()
              sessionRef.current = sessData.session?.id || null
            }
          }
        }

        const sessionId = sessionRef.current
        if (!sessionId) throw new Error('Failed to create session')

        await streamSSE(
          `${LINO_URL}/api/sessions/${sessionId}/chat`,
          { message: userText },
          abortRef.current.signal,
        )
      } else {
        // ── (reserved for future modes) ───────────────────────────────────────
        await streamSSE(
          '/api/chat',
          { message: userText, conversationId: metaRef.current.conversationId, sessionId: 'default' },
          abortRef.current.signal,
        )
      }

      // Fallback: if stream ended without a completion event
      setIsLoading(prev => {
        if (prev) {
          const msgId = currentAssistantMsgIdRef.current
          if (msgId) updateMessage(msgId, { isStreaming: false })
          resetInProgress()
        }
        return false
      })
      setInProgressStatusMessage('')

    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        const msgId = currentAssistantMsgIdRef.current
        if (msgId) updateMessage(msgId, { content: `连接失败: ${(err as Error)?.message}`, isStreaming: false })
      }
      setIsLoading(false)
      setInProgressStatusMessage('')
      resetInProgress()
    }
  }, [input, isLoading, mode, addMessage, updateMessage, processEvent, resetInProgress, streamSSE, modeRef])

  // Keep ref current so the sendPrompt handler (declared before handleSubmit)
  // always calls the latest closure (with up-to-date isLoading etc.).
  handleSubmitRef.current = handleSubmit

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isLoading && input.trim()) handleSubmit() }
  }

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  // ─── Derived ───────────────────────────────────────────────────────────────

  // Build the InProgressArtifact object for the current streaming message
  const currentInProgress: InProgressArtifact | undefined = isLoading ? {
    widgets: inProgressWidgets,
    planPhases: inProgressPlanPhases,
    currentPhaseId: inProgressCurrentPhaseId,
    isTransition: inProgressIsTransition,
    transitionMessage: inProgressTransitionMessage,
    thinkText: inProgressThinkText,
    statusMessage: inProgressStatusMessage,
    blocks: inProgressBlocks,
  } : undefined

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header style={{
        flexShrink: 0,
        borderBottom: '0.5px solid var(--border-default)',
        padding: '0 20px',
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="var(--accent)"/>
          </svg>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Artifacts
          </span>
        </div>

        {/* Header actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* JSON export — only shown when ARTIFACTS_DEBUG=true */}
          {process.env.NEXT_PUBLIC_DEBUG === 'true' && (
            <HeaderBtn
              label={jsonExportState === 'done' ? '已导出' : 'JSON'}
              icon={<Download width={11} height={11} />}
              disabled={!messages.length}
              done={jsonExportState === 'done'}
              onClick={handleJsonExport}
            />
          )}
          {/* Image export */}
          <HeaderBtn
            label={imgExportState === 'loading' ? '截图中…' : imgExportState === 'done' ? '已保存' : '导出图片'}
            icon={imgExportState === 'loading'
              ? <Loader2 width={11} height={11} style={{ animation: 'spin-accent 0.7s linear infinite' }} />
              : <ImageIcon width={11} height={11} />}
            disabled={!messages.length || imgExportState === 'loading'}
            done={imgExportState === 'done'}
            onClick={handleImgExport}
          />
          {/* Theme toggle */}
          <HeaderBtn
            label=""
            icon={theme === 'dark' ? <Sun width={12} height={12} /> : <Moon width={12} height={12} />}
            onClick={toggleTheme}
            square
          />
        </div>
      </header>

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div
          ref={messagesRootRef}
          style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px 12px' }}
        >
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: 80, paddingBottom: 40, opacity: 0.5 }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 14px', display: 'block' }}>
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="var(--accent)" opacity="0.6"/>
              </svg>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: 4 }}>有什么可以帮你的？</p>
              <p style={{ fontSize: '12.5px', color: 'var(--text-tertiary)' }}>发送任意请求，AI 将生成可视化内容</p>
            </div>
          )}

          {messages.map(msg => (
            <MessageItem
              key={msg.id}
              message={msg}
              isCurrentlyLoading={msg.id === currentAssistantMsgIdRef.current && isLoading}
              appMode={msg.role === 'assistant' ? mode : undefined}
              inProgress={
                msg.id === currentAssistantMsgIdRef.current && isLoading
                  ? currentInProgress
                  : undefined
              }
            />
          ))}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input ───────────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, borderTop: '0.5px solid var(--border-default)', padding: '14px 20px 16px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div
            style={{
              background: 'var(--bg-input)',
              border: '0.5px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: '10px 12px 10px 16px',
              display: 'flex',
              alignItems: 'flex-end',
              gap: 10,
              transition: 'border-color 150ms ease',
            }}
            onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKey}
              placeholder="发送消息… (Enter 发送，Shift+Enter 换行)"
              disabled={isLoading}
              rows={1}
              style={{
                flex: 1,
                background: 'transparent',
                resize: 'none',
                outline: 'none',
                border: 'none',
                fontSize: '14px',
                lineHeight: 1.6,
                color: 'var(--text-primary)',
                maxHeight: 160,
                fontFamily: 'var(--font-sans)',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <ModeToggle mode={mode} onChange={setMode} disabled={isLoading} />
              <button
                onClick={() => handleSubmit()}
                disabled={isLoading || !input.trim()}
                onMouseDown={e => { if (!isLoading && input.trim()) (e.currentTarget.style.transform = 'scale(0.95)') }}
                onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
                style={{
                  width: 30, height: 30,
                  borderRadius: 'var(--radius-md)',
                  background: (!isLoading && input.trim()) ? 'var(--accent)' : 'var(--bg-secondary)',
                  border: 'none',
                  cursor: (!isLoading && input.trim()) ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 150ms ease, transform 100ms ease',
                }}
              >
                {isLoading
                  ? <Loader2 width={13} height={13} style={{ color: 'var(--text-tertiary)', animation: 'spin-accent 0.7s linear infinite' }} />
                  : <ArrowUp width={13} height={13} style={{ color: input.trim() ? '#fff' : 'var(--text-disabled)' }} />
                }
              </button>
            </div>
          </div>
          <p style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-disabled)', marginTop: 8 }}>
            {mode === 'agent' ? 'Agent · 工具调用 + 代码执行' : 'Artifacts · 工具调用 + 可视化渲染'}
          </p>
        </div>
      </div>

      {/* ── Permission dialog (Agent mode) ───────────────────────────────────── */}
      {permissionRequest && (
        <PermissionDialog
          request={permissionRequest}
          onRespond={async (decision) => {
            setPermissionRequest(null)
            await fetch(`${LINO_URL}/api/permission/${permissionRequest.requestId}/respond`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ decision }),
            }).catch(() => {})
          }}
        />
      )}
    </div>
  )
}

// ─── Header button ────────────────────────────────────────────────────────────

function HeaderBtn({ label, icon, disabled, done, onClick, square }: {
  label: string; icon: React.ReactNode; disabled?: boolean; done?: boolean; onClick: () => void; square?: boolean
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: square ? 0 : 5,
        padding: square ? '0' : '4px 10px',
        width: square ? 28 : undefined,
        height: 28,
        borderRadius: 'var(--radius-md)',
        border: `0.5px solid ${done ? 'var(--success)' : hov ? 'var(--border-hover)' : 'var(--border-default)'}`,
        background: done ? 'var(--success-bg)' : hov ? 'var(--bg-secondary)' : 'transparent',
        color: done ? 'var(--success)' : disabled ? 'var(--text-disabled)' : 'var(--text-secondary)',
        fontSize: '11.5px',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 150ms ease',
        justifyContent: 'center',
      }}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  )
}
