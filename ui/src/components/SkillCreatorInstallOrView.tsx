'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Eye, Download } from 'lucide-react'

type WorkflowRes = { ok?: boolean; path?: string; error?: string; policy: unknown }

function detectSkillCreator(files: string[] | undefined, names: string[] | undefined): boolean {
  if (names?.some(n => n === 'skill-creator')) return true
  if (!files?.length) return false
  return files.some(
    f => f === 'skill-creator.md' || f.endsWith('/skill-creator.md') || f.replace(/\\/g, '/').endsWith('skill-creator.md'),
  )
}

const btnBase: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--text-primary)',
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
}

export function SkillCreatorInstallOrView({
  blinoUrl,
  panelOpen,
  fullWidth = true,
  compact = false,
  shortLabel = false,
  onMessage,
  onAfterInstall,
}: {
  blinoUrl: string
  /** When this becomes true, refetch whether skill-creator exists (e.g. settings sheet opened). */
  panelOpen: boolean
  fullWidth?: boolean
  /** Smaller button padding for 项目 panel inline row. */
  compact?: boolean
  /** Use shorter CTA for narrow / footer bars. */
  shortLabel?: boolean
  onMessage?: (message: string | null) => void
  onAfterInstall?: () => void
}) {
  const [files, setFiles] = useState<string[]>([])
  const [names, setNames] = useState<string[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [initLoading, setInitLoading] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [workflow, setWorkflow] = useState<WorkflowRes | null>(null)

  const hasSkillCreator = useMemo(() => detectSkillCreator(files, names), [files, names])

  const loadSkillsProbe = useCallback(async () => {
    setLoadErr(null)
    try {
      const r = await fetch(`${blinoUrl}/api/skills`)
      const d = await r.json().catch(() => ({})) as { files?: string[]; names?: string[]; error?: string }
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setFiles(d.files || [])
      setNames(d.names || [])
    } catch (e) {
      setLoadErr((e as Error).message)
      setFiles([])
      setNames([])
    }
  }, [blinoUrl])

  useEffect(() => {
    if (panelOpen) void loadSkillsProbe()
  }, [panelOpen, loadSkillsProbe])

  const openBrowse = async () => {
    setBrowseOpen(true)
    setDetailLoading(true)
    setWorkflow(null)
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${blinoUrl}/api/workflow`),
        fetch(`${blinoUrl}/api/skills`),
      ])
      const wf = (await r1.json()) as WorkflowRes
      const sk = await r2.json() as { files?: string[]; names?: string[]; error?: string }
      if (r2.ok) {
        setFiles(sk.files || [])
        setNames(sk.names || [])
      }
      setWorkflow(wf)
    } catch (e) {
      setLoadErr((e as Error).message)
    } finally {
      setDetailLoading(false)
    }
  }

  const installSkillCreator = async () => {
    setInitLoading(true)
    onMessage?.(null)
    try {
      const r = await fetch(`${blinoUrl}/api/init/skill-creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const d = await r.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string; path?: string; created?: boolean }
      if (!r.ok && d?.ok === false) {
        throw new Error(d.error || '安装失败')
      }
      if (d?.ok) {
        onMessage?.(
          d.created
            ? `已写入 ${d.path ?? '.blino/skills/skill-creator.md'}，对话中可执行 Skill「skill-creator」。`
            : (d.message || '已存在，未覆盖。新开会话或重载后可用。'),
        )
      } else {
        onMessage?.((d as { message?: string }).message || '未返回状态')
      }
      await loadSkillsProbe()
      onAfterInstall?.()
    } catch (e) {
      onMessage?.((e as Error).message)
    } finally {
      setInitLoading(false)
    }
  }

  const pol = workflow?.policy as {
    profile?: string
    schemaVersion?: number
    phases?: { id: string; notes?: string; activateSkillPacks?: string[] }[]
  } | null

  return (
    <>
      {loadErr && !hasSkillCreator && (
        <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '0 0 8px' }}>{loadErr}</p>
      )}

      {hasSkillCreator
        ? (
            <button
              type="button"
              onClick={() => { void openBrowse() }}
              style={{ ...btnBase, width: fullWidth ? '100%' : 'auto' }}
            >
              <Eye width={16} height={16} style={{ flexShrink: 0 }} />
              {shortLabel ? '查看 Skill / 流程' : '查看 project 内 Skill / workflow'}
            </button>
          )
        : (
            <button
              type="button"
              onClick={() => { void installSkillCreator() }}
              disabled={initLoading}
              style={{
                ...btnBase,
                width: fullWidth ? '100%' : 'auto',
                padding: compact ? '8px 12px' : '9px 12px',
                fontSize: compact ? 12 : 13,
                cursor: initLoading ? 'wait' : 'pointer',
                opacity: initLoading ? 0.7 : 1,
              }}
            >
              <Download width={14} height={14} style={{ display: 'inline', flexShrink: 0 }} />
              {initLoading ? '…' : shortLabel ? '安装 creator' : '安装 skill-creator'}
            </button>
          )}

      {browseOpen && (
        <div
          role="dialog"
          aria-label="项目 Skill 与 workflow"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)',
            padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) setBrowseOpen(false) }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(480px, 100%)',
              maxHeight: 'min(80vh, 640px)',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-primary)',
              borderRadius: 12,
              border: '0.5px solid var(--border-default)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ flexShrink: 0, padding: '14px 16px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>project 内 Skill / workflow</span>
              <button type="button" onClick={() => { setBrowseOpen(false) }} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
              {detailLoading
                ? <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>加载中…</p>
                : (
                    <>
                      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', margin: '0 0 6px' }}>workflow.json</p>
                      {workflow?.error
                        ? <p style={{ margin: '0 0 12px' }}>未配置或无法解析：{workflow.error}</p>
                        : pol
                          ? (
                              <>
                                {workflow?.path && (
                                  <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all' }}>{workflow.path}</p>
                                )}
                                <p style={{ margin: '0 0 4px' }}><strong>profile</strong>：{pol.profile ?? '—'}</p>
                                {pol.schemaVersion != null && <p style={{ margin: '0 0 8px' }}><strong>schemaVersion</strong>：{pol.schemaVersion}</p>}
                                {pol.phases && pol.phases.length > 0
                                  ? (
                                      <ol style={{ margin: '0 0 12px', paddingLeft: 18 }}>
                                        {pol.phases.map(phase => (
                                          <li key={phase.id} style={{ marginBottom: 8 }}>
                                            <code>{phase.id}</code>
                                            {phase.notes ? <span> — {phase.notes}</span> : null}
                                            {phase.activateSkillPacks?.length
                                              ? <div style={{ marginTop: 4, fontSize: 11 }}>packs: {phase.activateSkillPacks.join(', ')}</div>
                                              : null}
                                          </li>
                                        ))}
                                      </ol>
                                    )
                                  : <p style={{ margin: '0 0 12px' }}>（无 phases）</p>}
                              </>
                            )
                          : <p style={{ margin: '0 0 12px' }}>（无 policy）</p>}

                      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', margin: '12px 0 6px' }}>可加载的 Skill 名</p>
                      <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
                        {names.length ? names.map(n => <code key={n} style={{ display: 'inline-block', margin: '0 6px 4px 0', fontSize: 11 }}>{n}</code>) : '（无）'}
                      </p>

                      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', margin: '0 0 6px' }}>技能文件（.md 相对 .blino/skills）</p>
                      <ul style={{ margin: 0, paddingLeft: 16, maxHeight: 200, overflowY: 'auto' }}>
                        {files.length
                          ? files.map(f => <li key={f}><code style={{ fontSize: 11 }}>{f}</code></li>)
                          : <li>（无）</li>}
                      </ul>
                      {hasSkillCreator && (
                        <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--accent)' }}>已检测到 <code>skill-creator</code>，可直接在对话中执行 Skill <code>skill-creator</code>，无需再安装。</p>
                      )}
                    </>
                  )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
