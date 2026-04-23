'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, GitBranch, Loader2 } from 'lucide-react'
import { isReasonableMermaidSource } from '@/lib/workflow-mermaid'
import { WorkflowMermaidDiagram } from '@/components/WorkflowMermaidDiagram'

type PhaseInfo = { id: string; notes?: string; activateSkillPacks?: string[] }

type WorkflowStatic = {
  ok?: boolean
  error?: string
  policy: {
    profile?: string
    schemaVersion?: number
    mermaid?: string
    phases?: PhaseInfo[]
  } | null
}

type SessionWorkflow = {
  activePhaseId?: string
  activePhaseIndex?: number
  activeSkillPacks?: string[]
  phaseCount?: number
  profile?: string
  mermaid?: string
  phases?: PhaseInfo[]
}

const POLL_MS = 4000

const sectionBox: CSSProperties = {
  border: '0.5px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-tertiary)',
  marginBottom: 12,
  overflow: 'hidden',
}

const labelCaps: CSSProperties = {
  display: 'block',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  color: 'var(--text-tertiary)',
  marginBottom: 0,
  textTransform: 'uppercase' as const,
  fontFamily: 'var(--font-sans)',
}

const btnIcon: (disabled: boolean) => CSSProperties = (disabled) => ({
  padding: '0 4px',
  minWidth: 32,
  height: 32,
  borderRadius: 'var(--radius-md)',
  border: `0.5px solid ${disabled ? 'var(--border-default)' : 'var(--border-hover)'}`,
  background: disabled ? 'var(--bg-secondary)' : 'var(--bg-input)',
  color: disabled ? 'var(--text-disabled)' : 'var(--text-secondary)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background var(--duration-fast) var(--ease-smooth), border-color var(--duration-fast) var(--ease-smooth)',
})

/**
 * Workflow swimlane + Mermaid: lives only in 项目 panel (Claude / paper + terracotta accent).
 */
export function ProjectWorkflowSection({
  blinoUrl,
  sessionId,
  open,
  onPhaseChanged,
}: {
  blinoUrl: string
  sessionId: string | null
  open: boolean
  onPhaseChanged?: () => void
}) {
  const [staticWf, setStaticWf] = useState<WorkflowStatic | null>(null)
  const [sessionWf, setSessionWf] = useState<SessionWorkflow | null>(null)
  const [loading, setLoading] = useState(false)
  const [phaseBusy, setPhaseBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatic = useCallback(async () => {
    try {
      const r = await fetch(`${blinoUrl}/api/workflow`)
      const d = (await r.json()) as WorkflowStatic
      setStaticWf(d)
    } catch {
      setStaticWf(null)
    }
  }, [blinoUrl])

  const fetchSessionWf = useCallback(async () => {
    if (!sessionId) {
      setSessionWf(null)
      return
    }
    try {
      const r = await fetch(`${blinoUrl}/api/sessions/${sessionId}/workflow`)
      if (!r.ok) {
        setSessionWf(null)
        return
      }
      const d = (await r.json()) as { workflow?: SessionWorkflow }
      if (d.workflow) setSessionWf(d.workflow)
    } catch {
      setSessionWf(null)
    }
  }, [blinoUrl, sessionId])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([fetchStatic(), fetchSessionWf()])
    } finally {
      setLoading(false)
    }
  }, [fetchStatic, fetchSessionWf])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (!open) return
    pollRef.current = setInterval(() => {
      void fetchStatic()
      void fetchSessionWf()
    }, POLL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [open, fetchStatic, fetchSessionWf])

  const policy = staticWf?.policy
  const phases: PhaseInfo[] = sessionWf?.phases?.length
    ? sessionWf.phases
    : (policy?.phases && policy.phases.length > 0 ? policy.phases : [])
  const profile = sessionWf?.profile ?? policy?.profile
  const mermaidCustom = sessionWf?.mermaid ?? policy?.mermaid
  const phaseCount = phases.length
  const idx = sessionWf?.activePhaseIndex ?? 0
  const hasWorkflow = phaseCount > 0
  const navDisabled = !sessionId || phaseCount < 2
  const mermaidIsAuto = useMemo(
    () => !mermaidCustom || !isReasonableMermaidSource(mermaidCustom),
    [mermaidCustom],
  )

  const shiftPhase = async (delta: 1 | -1) => {
    if (!sessionId) {
      setHint('请先发送一条消息以建立会话，再切换阶段')
      return
    }
    if (!hasWorkflow || phaseCount < 2) {
      setHint('当前未配置多阶段，或仅一阶段')
      return
    }
    setPhaseBusy(true)
    setHint(null)
    try {
      const r = await fetch(`${blinoUrl}/api/sessions/${sessionId}/workflow/phase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta }),
      })
      const d = await r.json().catch(() => ({})) as { ok?: boolean; message?: string }
      if (!r.ok || d?.ok === false) {
        setHint((d as { message?: string }).message || '无法切换')
      } else {
        onPhaseChanged?.()
      }
      await fetchSessionWf()
    } catch (e) {
      setHint((e as Error).message)
    } finally {
      setPhaseBusy(false)
    }
  }

  if (!open) return null

  const hasAnyConfig = hasWorkflow || staticWf?.error || (profile && profile.length > 0)

  if (!hasAnyConfig) {
    return (
      <div style={sectionBox}>
        <div style={{ padding: '16px 18px' }}>
          <p style={{ ...labelCaps, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ display: 'flex', color: 'var(--accent)' }}><GitBranch width={16} height={16} strokeWidth={2} /></span>
            工作流
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
            未配置 <code style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>.blino/workflow.json</code>
            。可使用 Skill <code style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>skill-creator</code> 或手动添加。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={sectionBox}>
      {/* header strip — same language as app header: serif title, subtle border */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 16px',
          background: 'var(--bg-secondary)',
          borderBottom: '0.5px solid var(--border-default)',
        }}
      >
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...labelCaps, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'flex', color: 'var(--accent)' }}><GitBranch width={15} height={15} strokeWidth={2} /></span>
            工作流
          </span>
          {profile
            ? (
                <h3 style={{
                  margin: 0,
                  fontFamily: 'var(--font-serif)',
                  fontSize: '16px',
                  fontWeight: 500,
                  letterSpacing: '-0.02em',
                  color: 'var(--text-primary)',
                  lineHeight: 1.3,
                  wordBreak: 'break-word',
                }}
                >
                  {profile}
                </h3>
              )
            : <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>工作流</span>}
        </div>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          role="group"
          aria-label="阶段切换"
        >
          <button
            type="button"
            disabled={phaseBusy || navDisabled}
            onClick={() => { void shiftPhase(-1) }}
            title={!sessionId ? '需先建立会话' : '上一阶段'}
            style={btnIcon(phaseBusy || navDisabled)}
            onMouseEnter={e => {
              if (!phaseBusy && !navDisabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-bg)'
            }}
            onMouseLeave={e => {
              if (!navDisabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-input)'
            }}
          >
            <ChevronLeft width={18} height={18} />
          </button>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              minWidth: 48,
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              textAlign: 'center',
            }}
          >
            {phaseBusy
              ? <Loader2 width={14} height={14} style={{ color: 'var(--accent)', animation: 'spin-accent 0.7s linear infinite' }} />
              : (hasWorkflow ? `${idx + 1} / ${phaseCount}` : '—')}
          </span>
          <button
            type="button"
            disabled={phaseBusy || navDisabled}
            onClick={() => { void shiftPhase(1) }}
            title={!sessionId ? '需先建立会话' : '下一阶段'}
            style={btnIcon(phaseBusy || navDisabled)}
            onMouseEnter={e => {
              if (!phaseBusy && !navDisabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-bg)'
            }}
            onMouseLeave={e => {
              if (!navDisabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-input)'
            }}
          >
            <ChevronRight width={18} height={18} />
          </button>
        </div>
        {loading && !phaseBusy && (
          <Loader2 width={12} height={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0, animation: 'spin-accent 0.9s linear infinite' }} aria-hidden />
        )}
      </div>

      <div style={{ padding: '12px 16px' }}>
        {staticWf?.error && (
          <p style={{
            fontSize: 12,
            color: 'var(--danger)',
            margin: '0 0 12px',
            padding: '8px 10px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--danger-bg)',
            border: '0.5px solid var(--border-default)',
            lineHeight: 1.45,
          }}
          >
            配置解析：{staticWf.error}
          </p>
        )}

        {hasWorkflow && (
          <details style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
            <summary style={{ cursor: 'pointer', listStyle: 'none', userSelect: 'none' as const }}>
              为什么需要手动切换阶段？
            </summary>
            <p style={{ margin: '8px 0 0' }}>
              各阶段在 <code style={{ fontSize: 10 }}>workflow.json</code> 中定义，会决定**当前**加载哪几个 skill 包。Agent 无法仅凭对话就可靠地判断你处于业务流程的哪一步，所以由你通过 ← / →（或终端 <code style={{ fontSize: 10 }}>/phase</code>）显式切换。悬停流程图节点可查看该阶段的说明与包。
            </p>
          </details>
        )}

        {hint && (
          <p style={{ fontSize: 12, color: 'var(--warning)', margin: '0 0 10px', lineHeight: 1.5 }}>
            {hint}
          </p>
        )}

        {hasWorkflow && (
          <div
            style={{
              maxHeight: 'min(48vh, 420px)',
              minHeight: 64,
              overflow: 'auto',
              borderRadius: 'var(--radius-md)',
              border: '0.5px solid var(--border-default)',
              background: 'var(--bg-primary)',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <WorkflowMermaidDiagram
              customSource={mermaidCustom}
              phases={phases}
              activePhaseIndex={idx}
              isAuto={mermaidIsAuto}
            />
          </div>
        )}

        {hasWorkflow && (
          <p style={{ fontSize: 10, color: 'var(--text-tertiary)', margin: '8px 0 0', lineHeight: 1.45 }}>
            高亮 = 当前阶段。根字段 <code style={{ fontSize: 9 }}>mermaid</code> 可写任意图。宽图在框内滚动。
          </p>
        )}
      </div>
    </div>
  )
}
