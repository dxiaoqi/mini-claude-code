'use client'

import { useRef, useState, useEffect } from 'react'
import { Copy, Check, Image as ImageIcon, Loader2, ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { PlanProgress, type PlanPhase } from './PlanProgress'
import { WidgetRenderer, type WidgetState } from './WidgetRenderer'
import { VisualRenderer } from './VisualRenderer'
import { ProseMarkdown } from './ProseMarkdown'
import { ToolCallCard, type ToolCallItem } from './ToolCallCard'
import { exportMessageAsImage } from '@/lib/export-image'
import type { ContentBlock } from '@/lib/types'

export type { ToolCallItem }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  timestamp: number
  toolCalls?: ToolCallItem[]
  widgets?: WidgetState[]
  planPhases?: PlanPhase[]
  thinkText?: string
  artifactComplete?: boolean
  blocks?: ContentBlock[]
}

export interface InProgressArtifact {
  widgets: WidgetState[]
  planPhases: PlanPhase[]
  currentPhaseId: string | null
  isTransition: boolean
  transitionMessage: string
  thinkText: string
  statusMessage: string
  blocks?: ContentBlock[]
}

interface Props {
  message: ChatMessage
  inProgress?: InProgressArtifact
  /** True while the agent loop is still running for this message — absolute guard for action buttons */
  isCurrentlyLoading?: boolean
  /** Current app mode — shown as badge on the avatar row */
  appMode?: 'agent' | 'artifacts'
}

type ActionState = 'idle' | 'loading' | 'done'

// ─── Tool calls collapsible group ─────────────────────────────────────────────

function ToolCallsGroup({ toolCalls, isStreaming }: { toolCalls: ToolCallItem[]; isStreaming?: boolean }) {
  const hasRunning = toolCalls.some(t => t.status === 'running')
  const runningTool = toolCalls.find(t => t.status === 'running')
  const doneCount = toolCalls.filter(t => t.status === 'done' || t.status === 'error').length
  const total = toolCalls.length

  // Start expanded only when there's exactly 1 running tool (easy to see what's happening)
  const [expanded, setExpanded] = useState(total === 1)

  // Ticker: cycle through tool names while tools are running
  const [tickerIdx, setTickerIdx] = useState(0)
  useEffect(() => {
    if (!isStreaming || !hasRunning) return
    const id = setInterval(() => setTickerIdx(i => (i + 1) % Math.max(toolCalls.length, 1)), 1400)
    return () => clearInterval(id)
  }, [isStreaming, hasRunning, toolCalls.length])

  // Auto-collapse when a second tool arrives, or when all tools finish
  useEffect(() => {
    if (total > 1 || !hasRunning) setExpanded(false)
  }, [total, hasRunning])

  // Keep collapsed once streaming ends
  useEffect(() => {
    if (!isStreaming) setExpanded(false)
  }, [isStreaming])

  const tickerTool = toolCalls[tickerIdx % toolCalls.length]

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Header row: ticker during streaming, summary when done */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '6px 10px',
          marginBottom: expanded ? 6 : 0,
          background: 'var(--bg-secondary)',
          border: '0.5px solid var(--border-default)',
          borderRadius: expanded ? 'var(--radius-md) var(--radius-md) 0 0' : 'var(--radius-md)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'border-radius 120ms ease',
        }}
      >
        {/* Left: status icon */}
        {hasRunning
          ? <Loader2 width={11} height={11} style={{ color: 'var(--accent)', animation: 'spin-accent 0.7s linear infinite', flexShrink: 0 }} />
          : <Wrench width={11} height={11} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        }

        {/* Center: ticker or summary */}
        <span style={{ flex: 1, fontSize: '11.5px', color: 'var(--text-secondary)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {isStreaming && hasRunning && tickerTool ? (
            // Active tool running — show ticker
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                {runningTool?.name ?? tickerTool.name}
              </span>
              {doneCount > 0 && (
                <span style={{ color: 'var(--text-disabled)', fontSize: '10.5px' }}>
                  · {doneCount}/{total} 完成
                </span>
              )}
            </span>
          ) : isStreaming && !hasRunning ? (
            // All tools done but agent still streaming (next model call in progress)
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontWeight: 500 }}>{total} 个工具调用</span>
              <span style={{ color: 'var(--accent)', fontSize: '10.5px' }}>· 生成中…</span>
            </span>
          ) : (
            // Completed
            <span style={{ fontWeight: 500 }}>
              {total} 个工具调用
              {total > 0 && (
                <span style={{ color: 'var(--text-disabled)', fontWeight: 400, marginLeft: 6, fontSize: '10.5px' }}>
                  {toolCalls.map(t => t.name).join(' · ')}
                </span>
              )}
            </span>
          )}
        </span>

        {/* Right: expand/collapse chevron */}
        {expanded
          ? <ChevronDown width={11} height={11} style={{ color: 'var(--text-disabled)', flexShrink: 0 }} />
          : <ChevronRight width={11} height={11} style={{ color: 'var(--text-disabled)', flexShrink: 0 }} />
        }
      </button>

      {/* Expanded: individual ToolCallCards */}
      {expanded && (
        <div style={{
          border: '0.5px solid var(--border-default)',
          borderTop: 'none',
          borderRadius: '0 0 var(--radius-md) var(--radius-md)',
          overflow: 'hidden',
        }}>
          {toolCalls.map(tc => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── MessageItem ──────────────────────────────────────────────────────────────

export function MessageItem({ message, inProgress, isCurrentlyLoading, appMode }: Props) {
  const msgRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [copyState, setCopyState] = useState<ActionState>('idle')
  const [imgState, setImgState] = useState<ActionState>('idle')

  const isUser = message.role === 'user'
  const isGenerating = !!inProgress
  const hasRunningTool = message.toolCalls?.some(t => t.status === 'running') ?? false
  // isDone: all three guards must pass — isStreaming flag, inProgress prop, and explicit loading prop
  const isDone = !message.isStreaming && !isGenerating && !hasRunningTool && !isCurrentlyLoading

  const widgets = isGenerating ? inProgress!.widgets : (message.widgets ?? [])
  const planPhases = isGenerating ? inProgress!.planPhases : (message.planPhases ?? [])
  const currentPhaseId = isGenerating ? inProgress!.currentPhaseId : null
  const isTransition = isGenerating ? inProgress!.isTransition : false
  const transitionMessage = isGenerating ? inProgress!.transitionMessage : ''
  const thinkText = isGenerating ? inProgress!.thinkText : (message.thinkText ?? '')
  const hasArtifact = !!(isGenerating ? inProgress!.widgets.length > 0 : message.widgets?.length)

  const handleCopy = async () => {
    const text = message.content || widgets.map(w => w.content).join('\n\n')
    if (!text) return
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopyState('done')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  const handleExportImage = async () => {
    if (!msgRef.current) return
    setImgState('loading')
    try {
      await exportMessageAsImage(msgRef.current, msgRef.current, message.content.slice(0, 40), message.blocks)
      setImgState('done')
      setTimeout(() => setImgState('idle'), 2000)
    } catch {
      setImgState('idle')
    }
  }

  // ─── User message ──────────────────────────────────────────────────────────

  if (isUser) {
    return (
      <div
        className="flex justify-end group"
        style={{ marginBottom: 20 }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, maxWidth: '75%' }}>
          <div style={{ display: 'flex', gap: 4, opacity: hovered ? 1 : 0, transition: 'opacity 150ms ease', alignSelf: 'center' }}>
            <ActionButton icon={<Copy width={11} height={11} />} done={copyState === 'done'} label="复制" onClick={handleCopy} />
          </div>
          <div
            ref={msgRef}
            style={{
              background: 'var(--accent-bg)',
              border: '0.5px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              borderBottomRightRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              fontSize: '14px',
              lineHeight: 1.65,
              color: 'var(--text-primary)',
              wordBreak: 'break-word',
            }}
          >
            {message.content}
          </div>
        </div>
      </div>
    )
  }

  // ─── Assistant message ─────────────────────────────────────────────────────

  return (
    <div
      style={{ marginBottom: 28 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          width: 24, height: 24,
          borderRadius: '50%',
          background: 'var(--accent-bg)',
          border: '0.5px solid var(--border-default)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="var(--accent)"/>
          </svg>
        </div>
        <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text-secondary)' }}>
          {appMode === 'artifacts' ? 'Artifacts' : 'Agent'}
        </span>
        {appMode && (
          <span style={{
            fontSize: '10px',
            fontWeight: 500,
            padding: '1px 6px',
            borderRadius: 99,
            background: appMode === 'artifacts' ? 'rgba(99,102,241,0.12)' : 'rgba(20,184,166,0.12)',
            color: appMode === 'artifacts' ? '#818cf8' : '#2dd4bf',
            letterSpacing: '0.02em',
          }}>
            {appMode === 'artifacts' ? '⬡ Artifacts' : '⬡ Agent'}
          </span>
        )}
        {isGenerating && inProgress!.statusMessage && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11px', color: 'var(--text-tertiary)' }}>
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin-accent 0.9s linear infinite' }}>
              <circle cx="8" cy="8" r="6" stroke="var(--border-hover)" strokeWidth="2" fill="none"/>
              <path d="M8 2a6 6 0 0 1 6 6" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" fill="none"/>
            </svg>
            {inProgress!.statusMessage}
          </span>
        )}
      </div>

      {/* Content area */}
      <div ref={msgRef} style={{ paddingLeft: 32 }}>

        {/* ── Tool calls (collapsible group) ────────────────────────────── */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallsGroup toolCalls={message.toolCalls} isStreaming={message.isStreaming} />
        )}

        {/* ── Loading dots — show only when truly no content yet ────────── */}
        {(() => {
          const currentBlocks = isGenerating ? (inProgress?.blocks ?? []) : (message.blocks ?? [])
          const hasAnyContent = message.content || hasArtifact || currentBlocks.length > 0
          const waitingForContent = message.isStreaming && !hasAnyContent
          const waitingAfterTools = !message.toolCalls?.length || (!hasRunningTool && currentBlocks.length === 0)
          if (!waitingForContent || !waitingAfterTools) return null
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingTop: 4, paddingBottom: 4 }}>
              <span className="thinking-dots"><span /><span /><span /></span>
              {message.toolCalls?.length ? (
                <span style={{ fontSize: '11px', color: 'var(--text-disabled)' }}>生成中…</span>
              ) : null}
            </div>
          )
        })()}

        {/* ── Think bubble ──────────────────────────────────────────────── */}
        {thinkText && (
          <div
            className="animate-fade-in"
            style={{
              marginBottom: 14,
              padding: '9px 13px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-secondary)',
              border: '0.5px solid var(--border-default)',
              display: 'flex', alignItems: 'flex-start', gap: 7,
            }}
          >
            <span style={{ fontSize: '11px', opacity: 0.5, flexShrink: 0 }}>💭</span>
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontStyle: 'italic', lineHeight: 1.5 }}>
              {thinkText.slice(0, 120)}{thinkText.length > 120 ? '…' : ''}
            </span>
          </div>
        )}

        {/* ── Text (agent / conversational) ────────────────────────────── */}
        {message.content && !hasArtifact && (
          <ProseMarkdown content={message.content} isStreaming={message.isStreaming} />
        )}

        {/* ── Plan progress (Visual mode) ───────────────────────────────── */}
        {planPhases.length > 0 && (
          <PlanProgress
            phases={planPhases}
            currentPhaseId={currentPhaseId}
            isTransition={isTransition}
            transitionMessage={transitionMessage}
          />
        )}

        {/* ── Visual V2 blocks ──────────────────────────────────────────── */}
        {(() => {
          const blocks = isGenerating ? (inProgress?.blocks ?? []) : (message.blocks ?? [])
          if (!blocks.length) return null
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {blocks.map(block =>
                block.kind === 'text' ? (
                  <ProseMarkdown key={block.id} content={block.content} isStreaming={block.isStreaming} />
                ) : (
                  <VisualRenderer
                    key={block.id}
                    content={block.content}
                    declaredType={block.visualType}
                    isComplete={block.isComplete}
                    onSendPrompt={(text) => window.postMessage({ type: 'send-prompt', text }, '*')}
                  />
                )
              )}
            </div>
          )
        })()}

        {/* ── Legacy widgets ────────────────────────────────────────────── */}
        {widgets.length > 0 && !(isGenerating ? inProgress?.blocks?.length : message.blocks?.length) && (
          <div>
            {widgets.map(w => <WidgetRenderer key={w.id} widget={w} />)}
          </div>
        )}
      </div>

      {/* ── Action toolbar — only visible after generation completes ────── */}
      <div
        style={{
          paddingLeft: 32,
          marginTop: 8,
          display: 'flex',
          gap: 4,
          opacity: hovered && isDone ? 1 : 0,
          transition: 'opacity 150ms ease',
          pointerEvents: isDone ? 'auto' : 'none',
        }}
      >
        <ActionButton
          icon={copyState === 'done' ? <Check width={11} height={11} /> : <Copy width={11} height={11} />}
          done={copyState === 'done'}
          label={copyState === 'done' ? '已复制' : '复制'}
          onClick={handleCopy}
        />
        <ActionButton
          icon={imgState === 'loading'
            ? <Loader2 width={11} height={11} style={{ animation: 'spin-accent 0.7s linear infinite' }} />
            : imgState === 'done' ? <Check width={11} height={11} /> : <ImageIcon width={11} height={11} />}
          done={imgState === 'done'}
          label={imgState === 'loading' ? '截图中…' : imgState === 'done' ? '已保存' : '导出图片'}
          onClick={handleExportImage}
          disabled={imgState === 'loading'}
        />
      </div>
    </div>
  )
}

// ─── Small action button ──────────────────────────────────────────────────────

function ActionButton({ icon, done, label, onClick, disabled }: {
  icon: React.ReactNode
  done?: boolean
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 9px',
        borderRadius: 'var(--radius-md)',
        border: `0.5px solid ${done ? 'var(--success)' : hov ? 'var(--border-hover)' : 'var(--border-default)'}`,
        background: done ? 'var(--success-bg)' : hov ? 'var(--bg-secondary)' : 'transparent',
        color: done ? 'var(--success)' : 'var(--text-tertiary)',
        fontSize: '11px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 150ms ease',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
