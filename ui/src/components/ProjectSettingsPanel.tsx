'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { X, ChevronLeft, ChevronRight, RefreshCw, Sparkles, HelpCircle, FolderCode } from 'lucide-react'
import { SkillCreatorInstallOrView } from '@/components/SkillCreatorInstallOrView'

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.03em',
  color: 'var(--text-tertiary)',
  marginBottom: 6,
  textTransform: 'uppercase',
}

type WorkflowRes = { ok?: boolean; path?: string; error?: string; policy: unknown }

export function ProjectSettingsPanel({
  blinoUrl,
  open,
  onClose,
  activeSessionId,
}: {
  blinoUrl: string
  open: boolean
  onClose: () => void
  activeSessionId: string | null
}) {
  const [cwd, setCwd] = useState<string | null>(null)
  const [blinoDir, setBlinoDir] = useState<string>('.blino')
  const [skillFiles, setSkillFiles] = useState<string[]>([])
  const [skillNames, setSkillNames] = useState<string[]>([])
  const [workflow, setWorkflow] = useState<WorkflowRes | null>(null)
  const [wfInSession, setWfInSession] = useState<{
    activePhaseId?: string
    activePhaseIndex?: number
    phaseCount?: number
    profile?: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [phaseBusy, setPhaseBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [designHistory, setDesignHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [designInput, setDesignInput] = useState('')
  const [designLoading, setDesignLoading] = useState(false)
  const [proposed, setProposed] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('my-skill.md')

  const loadAll = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [w, s, sk] = await Promise.all([
        fetch(`${blinoUrl}/api/workspace`).then(r => r.json()) as Promise<{ cwd?: string; blinoDir?: string }>,
        fetch(`${blinoUrl}/api/workflow`).then(r => r.json()) as Promise<WorkflowRes>,
        fetch(`${blinoUrl}/api/skills`).then(r => r.json()) as Promise<{ files?: string[]; names?: string[]; error?: string }>,
      ])
      setCwd(w.cwd || null)
      if (w.blinoDir) setBlinoDir(w.blinoDir)
      setWorkflow(s)
      setSkillFiles(sk.files || [])
      setSkillNames(sk.names || [])

      if (activeSessionId) {
        const r = await fetch(`${blinoUrl}/api/sessions/${activeSessionId}`)
        if (r.ok) {
          const d = await r.json() as { workflow?: typeof wfInSession }
          if (d.workflow) setWfInSession(d.workflow)
        }
      } else {
        setWfInSession(null)
      }
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [blinoUrl, activeSessionId])

  useEffect(() => {
    if (open) void loadAll()
  }, [open, loadAll])

  const doRefresh = async () => {
    if (!activeSessionId) {
      setMessage('请先与 Agent 对话以建立会话后再刷新（或点击发送一条消息）')
      return
    }
    setMessage(null)
    try {
      const r = await fetch(`${blinoUrl}/api/sessions/${activeSessionId}/refresh`, { method: 'POST' })
      const d = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; skillNames?: string[] }
      if (r.ok && d?.ok !== false) {
        setSkillNames(d.skillNames || [])
        setMessage('已重载 .blino 与技能缓存')
        await loadAll()
      } else {
        setMessage(d.error || '刷新失败')
      }
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  const shiftPhase = async (delta: 1 | -1) => {
    if (!activeSessionId) {
      setMessage('需要活动会话。请先向 Agent 发送一条消息。')
      return
    }
    setPhaseBusy(true)
    setMessage(null)
    try {
      const r = await fetch(`${blinoUrl}/api/sessions/${activeSessionId}/workflow/phase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta }),
      })
      const d = await r.json().catch(() => ({})) as { ok?: boolean; message?: string; skillNames?: string[]; activePhaseId?: string; activePhaseIndex?: number }
      if (r.ok && d?.ok !== false) {
        setWfInSession(p => p ? { ...p, activePhaseId: d.activePhaseId, activePhaseIndex: d.activePhaseIndex } : null)
        if (d.skillNames) setSkillNames(d.skillNames)
        setMessage(d.message || '已切换阶段')
      } else {
        setMessage((d as { message?: string }).message || '无法切换（是否有 workflow 多阶段？）')
      }
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setPhaseBusy(false)
    }
  }

  const sendDesign = async () => {
    if (!activeSessionId) {
      setMessage('需要活动会话。')
      return
    }
    const t = designInput.trim()
    if (!t) return
    const next = [...designHistory, { role: 'user' as const, content: t }]
    setDesignHistory(next)
    setDesignInput('')
    setDesignLoading(true)
    setProposed(null)
    try {
      const r = await fetch(`${blinoUrl}/api/sessions/${activeSessionId}/skill-design`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const d = await r.json().catch(() => ({})) as { text?: string; error?: string; proposedFile?: string }
      if (!r.ok) throw new Error(d.error || '请求失败')
      const text = d.text || ''
      setDesignHistory(h => [...h, { role: 'assistant', content: text }])
      if (d.proposedFile) setProposed(d.proposedFile)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setDesignLoading(false)
    }
  }

  const saveProposed = async () => {
    if (!activeSessionId || !proposed) return
    setMessage(null)
    try {
      const r = await fetch(`${blinoUrl}/api/sessions/${activeSessionId}/skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: saveName.trim() || 'my-skill.md', content: proposed }),
      })
      const d = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; path?: string }
      if (!r.ok || d.ok === false) throw new Error(d.error || '保存失败')
      setMessage(`已保存: ${d.path}`)
      setCreateOpen(false)
      setDesignHistory([])
      setProposed(null)
      void loadAll()
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  if (!open) return null

  const pol = workflow?.policy as { profile?: string; phases?: { id: string }[] } | null
  const phaseCount = pol?.phases?.length || 0
  const phIdx = (wfInSession?.activePhaseIndex ?? 0) + 1

  return (
    <div
      role="dialog"
      aria-label="项目与 Skill"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(0,0,0,0.35)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <aside
        style={{
          width: 'min(420px, 100vw)',
          height: '100%',
          background: 'var(--bg-primary)',
          borderLeft: '0.5px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '0.5px solid var(--border-default)' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderCode width={18} height={18} /> 项目与 Skill
          </h2>
          <button type="button" aria-label="关闭" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
            <X width={20} height={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {loading ? (
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>加载中…</p>
          ) : (
            <>
              <p style={labelStyle}>工作区</p>
              <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', marginBottom: 12 }}>
                {cwd || '—'}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 16 }}>数据根目录名：<code>{blinoDir}</code></p>

              <details style={{ marginBottom: 16, fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <HelpCircle width={12} height={12} /> 本机与跨域
                </summary>
                <p style={{ margin: '8px 0 0' }}>
                  本 UI 在浏览器中访问。若 <code>fetch</code> 指向 <code>localhost:3001</code> 而页面来自 <code>localhost:3000</code>，属于**跨源**；后端需 CORS 允许该 Origin。开发时 <code>--cors-origin</code> 应含本页完整源，例如 <code>http://localhost:3000</code>；<code>localhost</code> 与 <code>127.0.0.1</code> 同端口已视为等价的开发主机。若用 <code>file://</code> 或源与配置不一致，会出现 <code>Failed to fetch</code>。仅 Node/同源脚本调用可不触发 CORS。
                </p>
              </details>

              <p style={labelStyle}>工作流 (workflow.json)</p>
              {workflow?.error
                ? <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>未加载或无效：{workflow.error}</p>
                : (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {pol?.profile ? <><strong>profile</strong>: {pol.profile}<br /></> : null}
                      {phaseCount > 0
                        ? (
                            <>
                              阶段 {phIdx} / {phaseCount}
                              {wfInSession?.activePhaseId
                                ? <> · 当前 <code>{wfInSession.activePhaseId}</code></>
                                : null}
                            </>
                          )
                        : '无 phases 或仅单阶段'}
                    </p>
                  )}

              {phaseCount > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <button
                    type="button"
                    onClick={() => { void shiftPhase(-1) }}
                    disabled={phaseBusy || !activeSessionId}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '0.5px solid var(--border-default)', background: 'var(--bg-secondary)', cursor: phaseBusy ? 'wait' : 'pointer' }}
                  >
                    <ChevronLeft width={16} height={16} style={{ display: 'block' }} />
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>阶段</span>
                  <button
                    type="button"
                    onClick={() => { void shiftPhase(1) }}
                    disabled={phaseBusy || !activeSessionId}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '0.5px solid var(--border-default)', background: 'var(--bg-secondary)', cursor: phaseBusy ? 'wait' : 'pointer' }}
                  >
                    <ChevronRight width={16} height={16} style={{ display: 'block' }} />
                  </button>
                </div>
              )}

              <p style={labelStyle}>项目内技能文件</p>
              <ul style={{ margin: '0 0 12px', paddingLeft: 16, maxHeight: 120, overflowY: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
                {skillFiles.length ? skillFiles.map(f => <li key={f}><code style={{ fontSize: 11 }}>{f}</code></li>) : <li>（无 .md）</li>}
              </ul>
              {skillNames.length > 0 && (
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>当前可加载的 skill 名：{skillNames.join(', ')}</p>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => { void doRefresh() }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 12, borderRadius: 8, border: '0.5px solid var(--border-default)', background: 'var(--bg-secondary)', cursor: 'pointer' }}
                >
                  <RefreshCw width={14} height={14} /> 重载与刷新
                </button>
                <div style={{ flex: '1 1 180px', minWidth: 140 }}>
                  <SkillCreatorInstallOrView
                    blinoUrl={blinoUrl}
                    panelOpen={open}
                    fullWidth
                    compact
                    onMessage={setMessage}
                    onAfterInstall={() => { void loadAll() }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setCreateOpen(true); setDesignHistory([]); setProposed(null); setDesignInput('') }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 12, borderRadius: 8, border: '0.5px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
                >
                  <Sparkles width={14} height={14} /> 创建 Skill
                </button>
              </div>

              {message && (
                <p style={{ fontSize: 12, color: message.startsWith('已') || message.includes('保存') ? 'var(--accent)' : 'var(--text-secondary)' }}>{message}</p>
              )}
            </>
          )}
        </div>
      </aside>

      {createOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)',
            padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) setCreateOpen(false) }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(440px, 100%)',
              maxHeight: '85vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-primary)',
              borderRadius: 12,
              border: '0.5px solid var(--border-default)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>创建 Skill（多轮）</span>
              <button type="button" onClick={() => { setCreateOpen(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X width={18} /></button>
            </div>
            <p style={{ margin: 0, padding: '0 16px 8px', fontSize: 11, color: 'var(--text-tertiary)' }}>
              用自然语言描述目标；多轮后模型可在回复末尾给出 <code>```blino-skill</code> 块，确认文件名后保存到 <code>.blino/skills/</code>。
            </p>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px' }}>
              {designHistory.map((m, i) => (
                <div key={i} style={{ marginBottom: 10, fontSize: 12, lineHeight: 1.5, color: m.role === 'user' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  <strong>{m.role === 'user' ? '你' : '助手'}</strong>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.content}</div>
                </div>
              ))}
            </div>
            {proposed && (
              <div style={{ padding: '8px 16px', background: 'var(--bg-secondary)' }}>
                <p style={labelStyle}>将保存为</p>
                <input
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  style={{ width: '100%', marginBottom: 8, padding: 8, fontSize: 12, fontFamily: 'var(--font-mono)', borderRadius: 6, border: '0.5px solid var(--border-default)', background: 'var(--bg-primary)' }}
                />
                <button type="button" onClick={() => { void saveProposed() }} style={{ width: '100%', padding: 10, fontSize: 13, border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>保存到项目</button>
              </div>
            )}
            <div style={{ padding: 12, display: 'flex', gap: 8, borderTop: '0.5px solid var(--border-default)' }}>
              <input
                value={designInput}
                onChange={e => setDesignInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendDesign() } }}
                placeholder="描述想做的 Skill…"
                disabled={designLoading}
                style={{ flex: 1, padding: 10, fontSize: 13, borderRadius: 8, border: '0.5px solid var(--border-default)', background: 'var(--bg-secondary)' }}
              />
              <button
                type="button"
                disabled={designLoading || !designInput.trim()}
                onClick={() => { void sendDesign() }}
                style={{ padding: '0 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: designLoading ? 'wait' : 'pointer' }}
              >
                发送
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
