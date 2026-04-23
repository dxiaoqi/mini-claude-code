'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, GitBranch } from 'lucide-react'
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

const cardStyle: CSSProperties = {
  border: '0.5px solid var(--border-default)',
  borderRadius: 12,
  background: 'var(--bg-secondary)',
  padding: 14,
  marginBottom: 18,
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.03em',
  color: 'var(--text-tertiary)',
  marginBottom: 8,
  textTransform: 'uppercase',
}

/**
 * Workflow swimlane + Mermaid: lives only in 项目 panel (not in chat main area).
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
      <div style={cardStyle}>
        <p style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <GitBranch width={14} height={14} /> 工作流
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0, lineHeight: 1.5 }}>
          未配置 <code style={{ fontSize: 10 }}>.blino/workflow.json</code>。可使用 Skill <code style={{ fontSize: 10 }}>skill-creator</code> 或手动添加。
        </p>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <GitBranch width={14} height={14} /> 工作流
          </p>
          {profile && (
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0, wordBreak: 'break-word' }}>
              {profile}
            </p>
          )}
          {loading && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>同步中…</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            disabled={phaseBusy || !sessionId || phaseCount < 2}
            onClick={() => { void shiftPhase(-1) }}
            title={!sessionId ? '需先建立会话' : '上一阶段'}
            style={{
              padding: '6px 8px',
              borderRadius: 8,
              border: '0.5px solid var(--border-default)',
              background: 'var(--bg-primary)',
              cursor: phaseBusy || !sessionId || phaseCount < 2 ? 'not-allowed' : 'pointer',
              opacity: phaseCount < 2 ? 0.4 : 1,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ChevronLeft width={18} height={18} />
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
            {hasWorkflow ? `${idx + 1} / ${phaseCount}` : '—'}
          </span>
          <button
            type="button"
            disabled={phaseBusy || !sessionId || phaseCount < 2}
            onClick={() => { void shiftPhase(1) }}
            title={!sessionId ? '需先建立会话' : '下一阶段'}
            style={{
              padding: '6px 8px',
              borderRadius: 8,
              border: '0.5px solid var(--border-default)',
              background: 'var(--bg-primary)',
              cursor: phaseBusy || !sessionId || phaseCount < 2 ? 'not-allowed' : 'pointer',
              opacity: phaseCount < 2 ? 0.4 : 1,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ChevronRight width={18} height={18} />
          </button>
        </div>
      </div>

      {staticWf?.error && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>解析：{staticWf.error}</p>
      )}

      {hasWorkflow && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: 12,
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
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 8,
                  border: `0.5px solid ${active ? 'var(--accent)' : 'var(--border-default)'}`,
                  background: active ? 'var(--bg-input)' : 'var(--bg-primary)',
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {i + 1}. {p.id}
              </span>
            )
          })}
        </div>
      )}

      {hasWorkflow && cur && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.5, wordBreak: 'break-word' }}>
          <strong>当前</strong> <code style={{ fontSize: 10 }}>{cur.id}</code>
          {cur.notes ? ` — ${cur.notes}` : null}
          {sessionWf?.activeSkillPacks && sessionWf.activeSkillPacks.length > 0 && (
            <span>
              {' '}
              · packs:{' '}
              {sessionWf.activeSkillPacks.map(p => (
                <code key={p} style={{ fontSize: 10, marginRight: 4 }}>{p}</code>
              ))}
            </span>
          )}
        </p>
      )}

      {hint && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>{hint}</p>}

      {hasWorkflow && (
        <div
          style={{
            maxHeight: 'min(50vh, 480px)',
            minHeight: 80,
            overflow: 'auto',
            borderRadius: 10,
            border: '0.5px solid var(--border-default)',
            background: 'var(--bg-primary)',
            padding: 12,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <WorkflowMermaidDiagram
            customSource={mermaidCustom}
            phases={phases}
            activePhaseIndex={idx}
          />
        </div>
      )}

      <p style={{ fontSize: 10, color: 'var(--text-tertiary)', margin: '10px 0 0', lineHeight: 1.45 }}>
        图可在 <code>workflow.json</code> 根字段 <code>mermaid</code> 自定义；未填写时由阶段自动生成。内容过多时在此区域滚动查看。
      </p>
    </div>
  )
}
