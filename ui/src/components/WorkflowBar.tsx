'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Layers } from 'lucide-react'
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

export function WorkflowBar({
  blinoUrl,
  sessionId,
  onOpenProject,
}: {
  blinoUrl: string
  sessionId: string | null
  /** Optional: focus 项目 panel (same as header 项目) */
  onOpenProject?: () => void
}) {
  const [expanded, setExpanded] = useState(true)
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
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    pollRef.current = setInterval(() => {
      void fetchStatic()
      void fetchSessionWf()
    }, POLL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchStatic, fetchSessionWf])

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
      setHint('当前项目未配置多阶段 workflow，或仅一阶段')
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
      }
      await fetchSessionWf()
    } catch (e) {
      setHint((e as Error).message)
    } finally {
      setPhaseBusy(false)
    }
  }

  if (!hasWorkflow && !staticWf?.error && !profile) {
    return (
      <div
        style={{
          flexShrink: 0,
          borderBottom: '0.5px solid var(--border-default)',
          background: 'var(--bg-secondary)',
          padding: '6px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          未配置 <code style={{ fontSize: 10 }}>.blino/workflow.json</code>
          {onOpenProject && (
            <>
              {' · '}
              <button
                type="button"
                onClick={onOpenProject}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}
              >
                项目
              </button>
              中查看
            </>
          )}
        </span>
      </div>
    )
  }

  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: '0.5px solid var(--border-default)',
        background: 'var(--bg-secondary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 16px',
          minHeight: 36,
        }}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => { setExpanded(e => !e) }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--text-tertiary)',
            padding: 2,
          }}
        >
          <Layers width={14} height={14} />
          {expanded ? <ChevronUp width={14} height={14} /> : <ChevronDown width={14} height={14} />}
        </button>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {profile && (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }} title="workflow profile">
              {profile}
            </span>
          )}
          {loading && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>…</span>}
          {hasWorkflow && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {phases.map((p, i) => {
                const active = i === idx
                return (
                  <span
                    key={`${p.id}-${i}`}
                    title={p.notes || p.id}
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 6,
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
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            disabled={phaseBusy || !sessionId || phaseCount < 2}
            onClick={() => { void shiftPhase(-1) }}
            title={!sessionId ? '需先建立会话' : '上一阶段'}
            style={{
              padding: '4px 6px',
              borderRadius: 6,
              border: '0.5px solid var(--border-default)',
              background: 'var(--bg-primary)',
              cursor: phaseBusy || !sessionId || phaseCount < 2 ? 'not-allowed' : 'pointer',
              opacity: phaseCount < 2 ? 0.45 : 1,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ChevronLeft width={16} height={16} />
          </button>
          <button
            type="button"
            disabled={phaseBusy || !sessionId || phaseCount < 2}
            onClick={() => { void shiftPhase(1) }}
            title={!sessionId ? '需先建立会话' : '下一阶段'}
            style={{
              padding: '4px 6px',
              borderRadius: 6,
              border: '0.5px solid var(--border-default)',
              background: 'var(--bg-primary)',
              cursor: phaseBusy || !sessionId || phaseCount < 2 ? 'not-allowed' : 'pointer',
              opacity: phaseCount < 2 ? 0.45 : 1,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ChevronRight width={16} height={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 10px 44px', fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {staticWf?.error && (
            <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)' }}>workflow：{staticWf.error}</p>
          )}
          {hasWorkflow && cur && (
            <p style={{ margin: 0 }}>
              <strong style={{ color: 'var(--text-secondary)' }}>当前</strong>
              {' '}
              <code style={{ fontSize: 10 }}>{cur.id}</code>
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
          {hint && <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)' }}>{hint}</p>}
          {hasWorkflow && (
            <WorkflowMermaidDiagram
              customSource={mermaidCustom}
              phases={phases}
              activePhaseIndex={idx}
            />
          )}
        </div>
      )}
    </div>
  )
}
