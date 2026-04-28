'use client'

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowUp, Loader2, Download, Image as ImageIcon, Sun, Moon, Settings } from 'lucide-react'
import { MessageItem, type ChatMessage, type InProgressArtifact, type ToolCallItem } from '@/components/MessageItem'
import { type WidgetState } from '@/components/WidgetRenderer'
import { type PlanPhase } from '@/components/PlanProgress'
import { type ContentBlock, type WorkflowSummary, type WorkflowTask, type WorkflowToast } from '@/lib/types'
import { WorkflowDAGCard } from '@/components/workflow/WorkflowDAGCard'
import { WorkflowToastStack } from '@/components/WorkflowToastStack'
import { ProjectPanel, ProjectPanelHeaderButton } from '@/components/ProjectPanel'
import { listWorkflows, getWorkflowDetail } from '@/lib/workflow-client'
import { workflowManager } from '@/lib/workflow-manager'
import { SlashMenu } from '@/components/slash/SlashMenu'
import { topologicalNodeIds } from '@/lib/workflow-topo'
import {
  exportConversationJson,
  exportConversationAsImage,
  type ExportableChatMessage,
} from '@/lib/export-image'
import { ModeToggle, type AppMode } from '@/components/ModeToggle'
import { PermissionDialog, type PermissionRequest } from '@/components/PermissionDialog'
import { SessionMenu } from '@/components/SessionMenu'
import { ApiSettingsPanel } from '@/components/ApiSettingsPanel'
import { splitRedactedThinking, stripThinkingFromContentBlocks, stripSvgTextWrapperTags } from '@/lib/redacted-thinking'
import { apiMessagesToChatMessages } from '@/lib/api-messages'
import { appendSessionUiMessage, withBlinoWfPrefix } from '@/lib/session-ui-sync'

/** 未提交前：仅表单元数据（运行态在 workflowManager） */
type WorkflowFormDraft = {
  workflow: WorkflowSummary
  formValues: Record<string, string>
  formErrors: Record<string, string>
  formSubmitting: boolean
}

const BLINO_URL = process.env.NEXT_PUBLIC_BLINO_URL || 'http://localhost:3001'

interface StreamMeta { conversationId?: string; artifactId?: string; turnId?: string; sessionId?: string }

let msgCounter = 0
function nextId() { return `msg_${++msgCounter}` }

/** 防止 React Strict 或重跑 effect 时重复 POST ui-message；module 级在 remount 后仍去重 */
const workflowUiMessageSyncedRunIds = new Set<string>()

let splitBlockCounter = 0
/**
 * Post-processing: scan each text block for:
 *  1. Embedded <visual type="...">...</visual> sequences (parser boundary edge case)
 *  2. Markdown fenced code blocks (```html / ```svg / ```threejs) — model compliance fallback
 * Both are promoted to proper visual blocks so the user sees a rendered component.
 */
/** Strip mistaken `<text>…</text>` prose wrappers; keep SVG `<text x=…>` (see redacted-thinking). */
function stripTextTags(s: string): string {
  return stripSvgTextWrapperTags(s)
}

function extractEmbeddedVisuals(blocks: ContentBlock[]): ContentBlock[] {
  const FENCE_RE = /```(html?|svg|threejs|javascript|js)\s*\n([\s\S]*?)(?:```|$)/gi

  const result: ContentBlock[] = []
  for (const block of blocks) {
    if (block.kind !== 'text') { result.push(block); continue }

    // Do not strip whole block first — that removes SVG <text> inside <visual>. Strip only plain-text paths.
    const content = block.content
    const hasVisual = content.includes('<visual')
    const hasFence = content.includes('```')

    // Fast path: nothing to extract
    if (!hasVisual && !hasFence) {
      if (content.trim()) result.push({ ...block, content: stripTextTags(content) })
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

    if (content.trim()) result.push({ ...block, content: stripTextTags(content) })
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
  const [mode, setMode] = useState<AppMode>('artifacts')
  const modeRef = useRef<AppMode>('artifacts')
  useEffect(() => { modeRef.current = mode }, [mode])

  // Highlight the correct server session when switching Agent / Artifacts
  useEffect(() => {
    setActiveSessionId(mode === 'agent' ? agentSessionIdRef.current : artifactsSessionIdRef.current)
  }, [mode])

  // Separate session refs per mode so each has its own system prompt context
  const agentSessionIdRef = useRef<string | null>(null)
  const artifactsSessionIdRef = useRef<string | null>(null)
  // Pending session creation Promise — avoids blocking the first message
  const artifactsSessionPromiseRef = useRef<Promise<void> | null>(null)

  /** Server session id for current mode — drives SessionMenu highlight */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  /** false 直到首屏从 URL 恢复 session/mode 完成，避免把 ?session= 冲掉 */
  const [urlSyncReady, setUrlSyncReady] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const replaceChatUrl = useCallback(
    (m: AppMode, sessionId: string | null) => {
      if (typeof window === 'undefined') return
      const params = new URLSearchParams(window.location.search)
      if (sessionId) params.set('session', sessionId)
      else params.delete('session')
      params.set('mode', m)
      const qs = params.toString()
      const next = `${pathname}?${qs}`
      const cur = `${window.location.pathname}${window.location.search}`
      if (cur !== next) router.replace(next, { scroll: false })
    },
    [pathname, router],
  )

  // Eagerly create Artifacts session in background when mode switches to 'artifacts'
  useEffect(() => {
    if (!urlSyncReady) return
    if (mode !== 'artifacts' || artifactsSessionIdRef.current || artifactsSessionPromiseRef.current) return
    artifactsSessionPromiseRef.current = (async () => {
      let systemPromptAddendum: string | undefined
      try {
        const ctxRes = await fetch(`${BLINO_URL}/api/visual-context`)
        if (ctxRes.ok) {
          const data = await ctxRes.json()
          systemPromptAddendum = data.content ?? undefined
        }
      } catch { /* skip */ }
      try {
        const sessRes = await fetch(`${BLINO_URL}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(systemPromptAddendum ? { systemPromptAddendum } : {}),
        })
        if (sessRes.ok) {
          const d = await sessRes.json()
          const sid = d.session?.id ?? null
          artifactsSessionIdRef.current = sid
          if (sid) setActiveSessionId(sid)
        }
      } catch { /* skip */ }
    })()
  }, [mode, urlSyncReady])

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

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [availableWorkflows, setAvailableWorkflows] = useState<WorkflowSummary[]>([])
  /** 失焦时隐藏 / 菜单，避免仅靠 input 无法收起 */
  const [slashMenuSuppressed, setSlashMenuSuppressed] = useState(false)
  const showSlashMenu = input.startsWith('/') && !slashMenuSuppressed

  const messagesRef = useRef<ChatMessage[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const [workflowFormDrafts, setWorkflowFormDrafts] = useState<Record<string, WorkflowFormDraft>>({})
  const [workflowTasks, setWorkflowTasks] = useState<WorkflowTask[]>([])
  const [workflowToasts, setWorkflowToasts] = useState<WorkflowToast[]>([])
  const [projectPanelOpen, setProjectPanelOpen] = useState(false)
  const workflowChatFinalizedRef = useRef<Set<string>>(new Set())
  const workflowDoneToastRef = useRef<Set<string>>(new Set())
  const workflowErrToastRef = useRef<Set<string>>(new Set())
  const workflowHilToastSeenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    void listWorkflows()
      .then(setAvailableWorkflows)
      .catch(() => { setAvailableWorkflows([]) })
  }, [])

  useEffect(() => {
    return workflowManager.subscribe(setWorkflowTasks)
  }, [])

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

  useEffect(() => {
    for (const t of workflowTasks) {
      const h = t.dagState?.hilState
      if (h && !h.decided && h.nodeId) {
        const key = `${t.runId}#${h.nodeId}`
        if (workflowHilToastSeenRef.current.has(key)) continue
        workflowHilToastSeenRef.current.add(key)
        setWorkflowToasts(prev => [
          ...prev,
          {
            id: `hil-${t.runId}-${h.nodeId}`,
            type: 'hil',
            runId: t.runId,
            workflowName: t.workflowName,
            nodeId: h.nodeId,
            question: h.question,
            options: h.options,
            waiterId: h.waiterId,
          },
        ])
      }
    }
  }, [workflowTasks])

  useEffect(() => {
    for (const t of workflowTasks) {
      if (t.status === 'done' && !workflowChatFinalizedRef.current.has(t.runId)) {
        workflowChatFinalizedRef.current.add(t.runId)
        const body = t.finalResult?.trim() ? t.finalResult : '_（无文本输出）_'
        updateMessage(t.messageId, {
          workflowPlaceholder: false,
          workflowComplete: true,
          content: `✓ **${t.workflowName}** 完成\n\n${body}`,
          workflowRunId: t.runId,
        })
      } else if (t.status === 'failed' && !workflowChatFinalizedRef.current.has(t.runId)) {
        workflowChatFinalizedRef.current.add(t.runId)
        const errText = t.lastError || t.dagState?.globalError || '工作流失败'
        updateMessage(t.messageId, {
          workflowPlaceholder: false,
          content: `**${t.workflowName}** 已失败\n\n${errText}`,
          workflowRunId: t.runId,
        })
      }
      if (t.status === 'done' && t.sessionId && !workflowUiMessageSyncedRunIds.has(t.runId)) {
        workflowUiMessageSyncedRunIds.add(t.runId)
        const body = t.finalResult?.trim() ? t.finalResult : '_（无文本输出）_'
        const visible = `✓ **${t.workflowName}** 完成\n\n${body}`
        void appendSessionUiMessage(BLINO_URL, t.sessionId, {
          role: 'assistant',
          content: withBlinoWfPrefix(visible, {
            v: 1, k: 'd', wn: t.workflowName, r: t.runId, i: t.workflowId, nm: true,
          }),
        })
      } else if (t.status === 'failed' && t.sessionId && !workflowUiMessageSyncedRunIds.has(t.runId)) {
        workflowUiMessageSyncedRunIds.add(t.runId)
        const errText = t.lastError || t.dagState?.globalError || '工作流失败'
        const visible = `**${t.workflowName}** 已失败\n\n${errText}`
        void appendSessionUiMessage(BLINO_URL, t.sessionId, {
          role: 'assistant',
          content: withBlinoWfPrefix(visible, {
            v: 1, k: 'f', wn: t.workflowName, r: t.runId, i: t.workflowId, nm: true,
          }),
        })
      }
    }
  }, [workflowTasks, updateMessage])

  useEffect(() => {
    const onTerminal = (e: Event) => {
      const d = (e as CustomEvent<{
        runId: string
        status?: string
        workflowName?: string
        lastError?: string
      }>).detail
      if (!d?.runId) return
      if (d.status === 'done' && !workflowDoneToastRef.current.has(d.runId)) {
        workflowDoneToastRef.current.add(d.runId)
        setWorkflowToasts(prev => [
          ...prev,
          {
            id: `done-${d.runId}`,
            type: 'done',
            runId: d.runId,
            workflowName: d.workflowName ?? '工作流',
            autoCloseMs: 3000,
          },
        ])
        return
      }
      if (d.status === 'failed' && !workflowErrToastRef.current.has(d.runId)) {
        workflowErrToastRef.current.add(d.runId)
        setWorkflowToasts(prev => [
          ...prev,
          {
            id: `err-${d.runId}`,
            type: 'error',
            runId: d.runId,
            workflowName: d.workflowName ?? '工作流',
            errorMessage: d.lastError ?? '工作流失败',
            autoCloseMs: 5000,
          },
        ])
      }
    }
    if (typeof window === 'undefined') return
    window.addEventListener('blino:workflow:terminal', onTerminal)
    return () => window.removeEventListener('blino:workflow:terminal', onTerminal)
  }, [])

  const appendSystemBubble = useCallback(
    (text: string) => {
      addMessage({ role: 'assistant', content: text, isStreaming: false })
    },
    [addMessage],
  )

  const resolveBlinoSessionId = useCallback(async (): Promise<string | null> => {
    const m = modeRef.current
    const sessionRef = m === 'agent' ? agentSessionIdRef : artifactsSessionIdRef
    if (sessionRef.current) return sessionRef.current
    if (m === 'artifacts' && artifactsSessionPromiseRef.current) {
      await artifactsSessionPromiseRef.current
    }
    if (sessionRef.current) return sessionRef.current
    try {
      const sessRes = await fetch(`${BLINO_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!sessRes.ok) return null
      const sessData = await sessRes.json()
      const id = (sessData.session?.id as string) || null
      sessionRef.current = id
      if (id) setActiveSessionId(id)
      return id
    } catch {
      return null
    }
  }, [])

  const handleFormSubmit = useCallback(
    async (messageId: string, workflow: WorkflowSummary, values: Record<string, string>) => {
      const errors: Record<string, string> = {}
      for (const input of workflow.inputs ?? []) {
        if (input.required && !values[input.id]?.trim()) {
          errors[input.id] = `${input.label} 不能为空`
        }
      }
      if (Object.keys(errors).length > 0) {
        setWorkflowFormDrafts(prev => {
          const c = prev[messageId]
          if (!c) return prev
          return { ...prev, [messageId]: { ...c, formErrors: errors } }
        })
        return
      }

      setWorkflowFormDrafts(prev => {
        const c = prev[messageId]
        if (!c) return prev
        return { ...prev, [messageId]: { ...c, formErrors: {}, formSubmitting: true } }
      })
      const sessionId = await resolveBlinoSessionId()
      if (!sessionId) {
        setWorkflowFormDrafts(prev => {
          const c = prev[messageId]
          if (!c) return prev
          return { ...prev, [messageId]: { ...c, formSubmitting: false } }
        })
        appendSystemBubble('无法建立 Blino 会话，请重试。')
        return
      }

      let graphNodes: Array<{ id: string; dependsOn: string[] }> =
        workflow.nodes?.length > 0
          ? workflow.nodes
          : (workflow.nodeIds ?? []).map(id => ({ id, dependsOn: [] as string[] }))
      let orderIds: string[] = workflow.nodeIds?.length
        ? workflow.nodeIds
        : graphNodes.length
          ? topologicalNodeIds(graphNodes)
          : []
      if (orderIds.length === 0) {
        const full = await getWorkflowDetail(workflow.id)
        if (full) {
          graphNodes =
            full.nodes?.length > 0
              ? full.nodes
              : (full.nodeIds ?? []).map(id => ({ id, dependsOn: [] as string[] }))
          orderIds = full.nodeIds?.length
            ? full.nodeIds
            : graphNodes.length
              ? topologicalNodeIds(graphNodes)
              : []
        }
      }
      if (orderIds.length === 0) {
        setWorkflowFormDrafts(prev => {
          const c = prev[messageId]
          if (!c) return prev
          return { ...prev, [messageId]: { ...c, formSubmitting: false } }
        })
        appendSystemBubble(
          '工作流无节点元数据。请确认：① 在含 .blino/workflows/ 的目录执行 blino；' +
            '② UI 的 NEXT_PUBLIC_BLINO_URL 指向该实例；③ 或升级 blino 后重试。',
        )
        return
      }

      let runId: string
      try {
        runId = await workflowManager.start({ workflow, sessionId, inputValues: values, messageId })
      } catch (e) {
        setWorkflowFormDrafts(prev => {
          const c = prev[messageId]
          if (!c) return prev
          return { ...prev, [messageId]: { ...c, formSubmitting: false } }
        })
        appendSystemBubble(`启动失败：${(e as Error).message}`)
        return
      }

      updateMessage(messageId, {
        workflowHost: false,
        workflowPlaceholder: true,
        workflowRunId: runId,
        content: `⬡ ${workflow.name} · 运行中…`,
        isStreaming: false,
      })

      // Write the host bubble to the backend now that we have the runId.
      // This lets apiMessagesToChatMessages deduplicate host+done pairs on refresh.
      if (sessionId) {
        void appendSessionUiMessage(BLINO_URL, sessionId, {
          role: 'assistant',
          content: withBlinoWfPrefix(`工作流：**${workflow.name}**`, {
            v: 1,
            k: 'h',
            wn: workflow.name,
            i: workflow.id,
            r: runId,
            nm: true,
          }),
        })
      }

      setWorkflowFormDrafts(prev => {
        const n = { ...prev }
        delete n[messageId]
        return n
      })
    },
    [appendSystemBubble, updateMessage, resolveBlinoSessionId],
  )

  const handleWorkflowSelect = useCallback(
    async (wf: WorkflowSummary) => {
      setInput('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      setSlashMenuSuppressed(true)

      let graphNodes: Array<{ id: string; dependsOn: string[] }> =
        wf.nodes?.length > 0
          ? wf.nodes
          : (wf.nodeIds ?? []).map(id => ({ id, dependsOn: [] as string[] }))
      let orderIds: string[] = wf.nodeIds?.length
        ? wf.nodeIds
        : graphNodes.length
          ? topologicalNodeIds(graphNodes)
          : []
      let merged: WorkflowSummary = { ...wf }
      if (orderIds.length === 0) {
        const full = await getWorkflowDetail(wf.id)
        if (full) {
          merged = {
            ...wf,
            ...full,
            name: full.name || wf.name,
            description: full.description ?? wf.description,
            inputs: full.inputs?.length ? full.inputs : wf.inputs,
            nodeIds: full.nodeIds?.length ? full.nodeIds : wf.nodeIds,
            nodes: full.nodes?.length ? full.nodes : wf.nodes,
            nodeCount: full.nodeCount ?? wf.nodeCount,
          }
          graphNodes =
            merged.nodes?.length > 0
              ? merged.nodes
              : (merged.nodeIds ?? []).map(id => ({ id, dependsOn: [] as string[] }))
          orderIds = merged.nodeIds?.length
            ? merged.nodeIds
            : graphNodes.length
              ? topologicalNodeIds(graphNodes)
              : []
        }
      }
      if (orderIds.length === 0) {
        appendSystemBubble(
          '工作流无节点元数据。请确认：① 在含 .blino/workflows/ 的目录执行 blino；' +
            '② UI 的 NEXT_PUBLIC_BLINO_URL 指向该实例；③ 或升级 blino 后重试。',
        )
        return
      }

      const defaults: Record<string, string> = {}
      for (const input of merged.inputs ?? []) {
        if (input.default) defaults[input.id] = input.default
      }

      const sessionId = await resolveBlinoSessionId()
      const msgId = addMessage({
        role: 'assistant',
        content: `工作流：**${merged.name}**`,
        workflowHost: true,
        isStreaming: false,
      })
      // Note: backend ui-message for the host bubble is written after start()
      // so we can include the runId, enabling deduplication on page refresh.
      setWorkflowFormDrafts(prev => ({
        ...prev,
        [msgId]: {
          workflow: merged,
          formValues: defaults,
          formErrors: {},
          formSubmitting: false,
        },
      }))

      if (!merged.inputs || merged.inputs.length === 0) {
        void handleFormSubmit(msgId, merged, {})
      }
    },
    [appendSystemBubble, handleFormSubmit, addMessage, resolveBlinoSessionId],
  )

  const handleWorkflowToastHil = useCallback(
    async (toastId: string, runId: string, nodeId: string, decision: 'approve' | 'reject') => {
      try {
        const toast = workflowToasts.find(t => t.id === toastId)
        await workflowManager.decide(runId, nodeId, decision, toast?.waiterId)
        setWorkflowToasts(prev => prev.filter(t => t.id !== toastId))
      } catch {
        appendSystemBubble('无法发送工作流决策，请重试')
      }
    },
    [appendSystemBubble, workflowToasts],
  )

  const dismissWorkflowToast = useCallback((id: string) => {
    setWorkflowToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const fetchVisualContextBody = useCallback(async (): Promise<string | undefined> => {
    try {
      const ctxRes = await fetch(`${BLINO_URL}/api/visual-context`)
      if (!ctxRes.ok) return undefined
      const data = await ctxRes.json()
      return data.content ?? undefined
    } catch {
      return undefined
    }
  }, [])

  const startNewSession = useCallback(async () => {
    if (isLoading) return
    abortRef.current?.abort()
    resetInProgress()
    workflowManager.reset()
    workflowChatFinalizedRef.current = new Set()
    workflowDoneToastRef.current = new Set()
    workflowErrToastRef.current = new Set()
    workflowHilToastSeenRef.current = new Set()
    setWorkflowToasts([])
    setWorkflowFormDrafts({})
    setMessages([])
    setIsLoading(false)
    currentAssistantMsgIdRef.current = null

    if (mode === 'agent') {
      agentSessionIdRef.current = null
      try {
        const sessRes = await fetch(`${BLINO_URL}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (sessRes.ok) {
          const sessData = await sessRes.json()
          const id = sessData.session?.id ?? null
          agentSessionIdRef.current = id
          if (id) setActiveSessionId(id)
        }
      } catch { /* ignore */ }
      return
    }

    artifactsSessionIdRef.current = null
    artifactsSessionPromiseRef.current = null
    const addendum = await fetchVisualContextBody()
    try {
      const sessRes = await fetch(`${BLINO_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addendum ? { systemPromptAddendum: addendum } : {}),
      })
      if (sessRes.ok) {
        const sessData = await sessRes.json()
        const id = sessData.session?.id ?? null
        artifactsSessionIdRef.current = id
        if (id) setActiveSessionId(id)
      }
    } catch { /* ignore */ }
  }, [isLoading, resetInProgress, mode, fetchVisualContextBody])

  const switchToSession = useCallback(async (sessionId: string, modeForSession?: AppMode) => {
    if (isLoading) return
    const effMode = modeForSession ?? modeRef.current
    abortRef.current?.abort()
    resetInProgress()
    workflowManager.reset()
    workflowChatFinalizedRef.current = new Set()
    workflowDoneToastRef.current = new Set()
    workflowErrToastRef.current = new Set()
    workflowHilToastSeenRef.current = new Set()
    setWorkflowToasts([])
    setWorkflowFormDrafts({})
    setIsLoading(false)
    currentAssistantMsgIdRef.current = null

    const body: Record<string, unknown> = { resumeSessionId: sessionId }
    if (effMode === 'artifacts') {
      const addendum = await fetchVisualContextBody()
      if (addendum) body.systemPromptAddendum = addendum
    }

    try {
      const sessRes = await fetch(`${BLINO_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!sessRes.ok) return
      const sessData = await sessRes.json()
      const id = sessData.session?.id ?? sessionId

      if (effMode === 'agent') agentSessionIdRef.current = id
      else artifactsSessionIdRef.current = id

      setActiveSessionId(id)

      const stateRes = await fetch(`${BLINO_URL}/api/sessions/${id}`)
      if (!stateRes.ok) {
        setMessages([])
        return
      }
      const stateData = await stateRes.json() as { messages?: Array<{ role: string; content: unknown }> }
      const chat = apiMessagesToChatMessages(stateData.messages ?? [], id)
      setMessages(chat)

      // Reattach to any workflows that were running when the page was refreshed.
      const reattached = await workflowManager.reattach(
        chat.map(m => ({ id: m.id, workflowRunId: m.workflowRunId, workflowPlaceholder: m.workflowPlaceholder, workflowHost: m.workflowHost })),
      )
      // Mark reattached workflow messages as placeholders so completion updates them correctly.
      for (const { messageId, runId, workflowName } of reattached) {
        updateMessage(messageId, {
          workflowHost: false,
          workflowPlaceholder: true,
          workflowRunId: runId,
          content: `⬡ ${workflowName} · 运行中…`,
          isStreaming: false,
        })
      }
    } catch { /* ignore */ }
  }, [isLoading, resetInProgress, fetchVisualContextBody, updateMessage])

  const switchToSessionRef = useRef(switchToSession)
  switchToSessionRef.current = switchToSession

  /** 刷新后从 ?session=&mode= 恢复；完成后才允许把当前会话写回 URL */
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sidRaw = params.get('session')?.trim() ?? ''
    const urlMode = params.get('mode')
    const sidOk = sidRaw.length > 0 && /^[0-9a-fA-F-]{8,}$/.test(sidRaw)
    const hasMode = urlMode === 'agent' || urlMode === 'artifacts'

    if (!sidOk && !hasMode) {
      setUrlSyncReady(true)
      return
    }

    const boot = async () => {
      try {
        if (hasMode) {
          setMode(urlMode as AppMode)
          modeRef.current = urlMode as AppMode
        }
        if (sidOk) {
          await switchToSessionRef.current(sidRaw, hasMode ? (urlMode as AppMode) : undefined)
        }
      } finally {
        setUrlSyncReady(true)
      }
    }
    void boot()
  }, [])

  useEffect(() => {
    if (!urlSyncReady) return
    replaceChatUrl(mode, activeSessionId)
  }, [urlSyncReady, mode, activeSessionId, replaceChatUrl])

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

            // Strip reasoning-model wrappers (e.g. redacted_thinking / think) from public stream → 💭 bubble.
            const { publicText, thinking } = splitRedactedThinking(s.textAccum)
            setInProgressThinkText(thinking)

            // Detect opening <visual type="..."> tag (may arrive across multiple chunks)
            const visualOpenIdx = publicText.indexOf('<visual')
            if (visualOpenIdx !== -1) {
              const gtIdx = publicText.indexOf('>', visualOpenIdx)
              if (gtIdx !== -1) {
                // Full opening tag received — commit text before it, start visual
                const tag = publicText.slice(visualOpenIdx, gtIdx + 1)
                const typeMatch = tag.match(/type\s*=\s*['"]([^'"]+)['"]/)
                if (typeMatch) {
                  const beforeText = stripTextTags(publicText.slice(0, visualOpenIdx))
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
                  s.visualAccum = publicText.slice(gtIdx + 1)
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
              const displayText = stripTextTags(publicText)
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
          // Agent mode: append; keep <think> / <think> out of main body (💭 bubble).
          setMessages(prev => prev.map(m => {
            if (m.id !== msgId) return m
            const full = m.content + chunk
            const { publicText, thinking } = splitRedactedThinking(full)
            return { ...m, content: publicText, thinkText: thinking || undefined, isStreaming: true }
          }))
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

          let remainingText = ''
          if (s.inVisual) {
            // Never strip visual payload — would delete SVG <text> labels
            remainingText = s.visualAccum.trim()
          } else {
            const sp = splitRedactedThinking(s.textAccum)
            remainingText = stripTextTags(sp.publicText)
          }
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
                const { blocks: cleanedBlocks, thinking: thinkFromBlocks } = stripThinkingFromContentBlocks(blocksToCommit)
                const updated = prev.map(m => {
                  if (m.id !== msgId) return m
                  const thinkMerged = [m.thinkText, thinkFromBlocks].filter(Boolean).join('\n\n') || undefined
                  return {
                    ...m,
                    content: '',
                    isStreaming: false,
                    blocks: cleanedBlocks,
                    thinkText: thinkMerged,
                    artifactComplete: true,
                  }
                })
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
              const { blocks: cleaned, thinking: tExtra } = stripThinkingFromContentBlocks(committed)
              console.log('[done/agent] committing blocks:', cleaned.length)
              setMessages(prev => prev.map(m => {
                if (m.id !== msgId) return m
                const thinkMerged = [m.thinkText, tExtra].filter(Boolean).join('\n\n') || undefined
                return { ...m, content: '', isStreaming: false, blocks: cleaned, thinkText: thinkMerged, artifactComplete: true }
              }))
            } else if (msgId) {
              console.log('[done/agent] no inProgressBlocks, marking done')
              setMessages(prev => prev.map(m => {
                if (m.id !== msgId) return m
                const { publicText, thinking } = splitRedactedThinking(m.content)
                return {
                  ...m,
                  content: publicText,
                  thinkText: [m.thinkText, thinking].filter(Boolean).join('\n\n') || undefined,
                  isStreaming: false,
                }
              }))
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
    if (userText === '/' || (overrideText == null && showSlashMenu)) return
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
        // ── Agent / Artifacts mode: directly connect to blino HTTP server ─
        const sessionRef = mode === 'agent' ? agentSessionIdRef : artifactsSessionIdRef

        if (!sessionRef.current) {
          if (mode === 'artifacts' && artifactsSessionPromiseRef.current) {
            // Session is being created in the background — await it instead of re-fetching
            await artifactsSessionPromiseRef.current
          } else {
            // Agent mode or fallback: create session on-demand (no addendum needed)
            const sessRes = await fetch(`${BLINO_URL}/api/sessions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            })
            if (sessRes.ok) {
              const sessData = await sessRes.json()
              sessionRef.current = sessData.session?.id || null
              if (sessionRef.current) setActiveSessionId(sessionRef.current)
            }
          }
        }

        const sessionId = sessionRef.current
        if (!sessionId) throw new Error('Failed to create session')

        await streamSSE(
          `${BLINO_URL}/api/sessions/${sessionId}/chat`,
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

      // Stream closed: if server never sent done/error, still unlock UI
      const msgId = currentAssistantMsgIdRef.current
      if (msgId) updateMessage(msgId, { isStreaming: false })
      resetInProgress()
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        const msgId = currentAssistantMsgIdRef.current
        if (msgId) updateMessage(msgId, { content: `连接失败: ${(err as Error)?.message}`, isStreaming: false })
      }
      resetInProgress()
    } finally {
      setIsLoading(false)
      setInProgressStatusMessage('')
    }
  }, [input, isLoading, mode, addMessage, updateMessage, processEvent, resetInProgress, streamSSE, modeRef, showSlashMenu])

  // Keep ref current so the sendPrompt handler (declared before handleSubmit)
  // always calls the latest closure (with up-to-date isLoading etc.).
  handleSubmitRef.current = handleSubmit

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (showSlashMenu) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      if (!isLoading && input.trim()) handleSubmit()
    }
  }

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setInput(v)
    if (v.startsWith('/')) {
      setSlashMenuSuppressed(false)
    } else {
      setSlashMenuSuppressed(false)
    }
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
        background: 'var(--bg-primary)',
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
          <ProjectPanelHeaderButton
            runningCount={workflowTasks.filter(t => t.status === 'running').length}
            onClick={() => { setProjectPanelOpen(o => !o) }}
          />
          <SessionMenu
            blinoUrl={BLINO_URL}
            disabled={isLoading}
            activeSessionId={activeSessionId}
            onNewSession={startNewSession}
            onSwitchSession={switchToSession}
          />
          <HeaderBtn
            label="设置"
            icon={<Settings width={12} height={12} />}
            onClick={() => setSettingsOpen(true)}
            square={false}
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
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          marginRight: projectPanelOpen ? 380 : 0,
          transition: 'margin-right 0.2s ease',
        }}
      >
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

          {messages.map(msg => {
            const cell = msg.workflowHost ? workflowFormDrafts[msg.id] : undefined
            return (
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
                workflowSlot={
                  msg.workflowHost && cell ? (
                    <WorkflowDAGCard
                      docked
                      workflow={cell.workflow}
                      dagState={null}
                      formValues={cell.formValues}
                      formErrors={cell.formErrors}
                      formSubmitting={cell.formSubmitting}
                      onFormChange={(fid, val) => {
                        setWorkflowFormDrafts(prev => {
                          const c = prev[msg.id]
                          if (!c) return prev
                          return {
                            ...prev,
                            [msg.id]: { ...c, formValues: { ...c.formValues, [fid]: val } },
                          }
                        })
                      }}
                      onFormSubmit={() => { void handleFormSubmit(msg.id, cell.workflow, cell.formValues) }}
                      onFormCancel={() => {
                        const t = workflowTasks.find(x => x.messageId === msg.id)
                        if (t?.status === 'running') {
                          appendSystemBubble('请等待工作流完成后再从对话中移除。')
                          return
                        }
                        setMessages(prev => prev.filter(m => m.id !== msg.id))
                        setWorkflowFormDrafts(prev => {
                          const n = { ...prev }
                          delete n[msg.id]
                          return n
                        })
                      }}
                      onHILDecide={() => {}}
                    />
                  ) : undefined
                }
              />
            )
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input ───────────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        borderTop: '0.5px solid var(--border-default)',
        padding: '14px 20px 16px',
        background: 'var(--bg-primary)',
      }}>
        <div style={{ maxWidth: 760, margin: '0 auto', position: 'relative' }}>
          {showSlashMenu && (
            <SlashMenu
              query={input.startsWith('/') ? input.slice(1) : ''}
              workflows={availableWorkflows}
              onSelectWorkflow={handleWorkflowSelect}
              onSelectSession={action => {
                if (action === 'new') {
                  setInput('')
                  if (textareaRef.current) textareaRef.current.style.height = 'auto'
                  setSlashMenuSuppressed(true)
                  void startNewSession()
                }
              }}
              onOpenSettings={() => {
                setSettingsOpen(true)
                setInput('')
                if (textareaRef.current) textareaRef.current.style.height = 'auto'
                setSlashMenuSuppressed(true)
              }}
              onDismiss={() => {
                setInput('')
                if (textareaRef.current) textareaRef.current.style.height = 'auto'
                setSlashMenuSuppressed(true)
                textareaRef.current?.focus()
              }}
            />
          )}
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
              onBlur={() => { setSlashMenuSuppressed(true) }}
              onFocus={() => { if (input.startsWith('/')) setSlashMenuSuppressed(false) }}
              placeholder="发送消息… 输入 / 选择 workflow (Enter 发送，Shift+Enter 换行)"
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
                disabled={isLoading || !input.trim() || showSlashMenu}
                onMouseDown={e => { if (!isLoading && input.trim() && !showSlashMenu) (e.currentTarget.style.transform = 'scale(0.95)') }}
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
            await fetch(`${BLINO_URL}/api/permission/${permissionRequest.requestId}/respond`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ decision }),
            }).catch(() => {})
          }}
        />
      )}

      <ApiSettingsPanel
        blinoUrl={BLINO_URL}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <ProjectPanel
        open={projectPanelOpen}
        onClose={() => { setProjectPanelOpen(false) }}
        tasks={workflowTasks}
      />

      <WorkflowToastStack
        toasts={workflowToasts}
        onHILDecide={handleWorkflowToastHil}
        onDismiss={dismissWorkflowToast}
      />
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
      type="button"
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
