'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, GitBranch, Loader2 } from 'lucide-react'
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
  marginBottom: 20,
  boxShadow: '0 1px 0 var(--border-default)',
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
  const cur = phaseCount > 0 ? phases[Math.min(Math.max(0, idx), phaseCount - 1)] : undefined
  const hasWorkflow = phaseCount > 0
  const navDisabled = !sessionId || phaseCount < 2

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

      <div style={{ padding: '14px 16px 16px' }}>
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
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 14,
              alignItems: 'center',
            }}
          >
            {phases.map((p, i) => {
              const active = i === idx
              return (
                <span
                  key={`${p.id}-${i}`}
                  title={p.notes || p.id}
                  style={{
                    fontSize: 12,
                    padding: '5px 11px',
                    borderRadius: 'var(--radius-full)',
                    border: `0.5px solid ${active ? 'var(--accent)' : 'var(--border-default)'}`,
                    background: active ? 'var(--accent-bg)' : 'var(--bg-input)',
                    color: active ? 'var(--accent)' : 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: active ? 500 : 400,
                    transition: 'background var(--duration-fast) var(--ease-smooth), color var(--duration-fast) var(--ease-smooth), border-color var(--duration-fast) var(--ease-smooth)',
                  }}
                >
                  {i + 1}. {p.id}
                </span>
              )
            })}
          </div>
        )}

        {hasWorkflow && cur && (
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              margin: '0 0 12px',
              lineHeight: 1.6,
              wordBreak: 'break-word',
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-secondary)',
              border: '0.5px solid var(--border-default)',
            }}
          >
            <span style={{ color: 'var(--text-tertiary)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>当前阶段</span>
            <div style={{ marginTop: 4 }}>
              <code style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{cur.id}</code>
              {cur.notes ? <span> — {cur.notes}</span> : null}
            </div>
            {sessionWf?.activeSkillPacks && sessionWf.activeSkillPacks.length > 0 && (
              <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-tertiary)' }}>
                技能包{' '}
                {sessionWf.activeSkillPacks.map(p => (
                  <code
                    key={p}
                    style={{ fontSize: 11, fontFamily: 'var(--font-mono)', marginRight: 6, color: 'var(--text-secondary)' }}
                  >
                    {p}
                  </code>
                ))}
              </p>
            )}
          </div>
        )}

        {hint && (
          <p style={{ fontSize: 12, color: 'var(--warning)', margin: '0 0 10px', lineHeight: 1.5 }}>
            {hint}
          </p>
        )}

        {hasWorkflow && (
          <div>
            <p style={{ ...labelCaps, marginBottom: 8 }}>流程图</p>
            <div
              style={{
                maxHeight: 'min(50vh, 480px)',
                minHeight: 80,
                overflow: 'auto',
                borderRadius: 'var(--radius-md)',
                border: '0.5px solid var(--border-default)',
                background: 'var(--bg-primary)',
                padding: 14,
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <WorkflowMermaidDiagram
                customSource={mermaidCustom}
                phases={phases}
                activePhaseIndex={idx}
              />
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-tertiary)', margin: '10px 0 0', lineHeight: 1.5 }}>
              在 <code style={{ fontSize: 10 }}>workflow.json</code> 根级填写 <code style={{ fontSize: 10 }}>mermaid</code> 可完全自定义；未填则按阶段自动生成。宽图可在此区域内横向滚动。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
