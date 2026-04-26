'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkflowSummary, SlashCommandItem } from '@/lib/types'

export interface SlashMenuProps {
  query: string
  workflows: WorkflowSummary[]
  onSelectWorkflow: (wf: WorkflowSummary) => void
  onSelectSession: (action: 'new') => void
  onDismiss: () => void
  onOpenSettings?: () => void
}

const SKILL_STUBS: { id: string; name: string; description: string }[] = [
  { id: 's1', name: '总结要点', description: '从长文本提取要点' },
  { id: 's2', name: '代码审查', description: '对代码 diff 做评审' },
  { id: 's3', name: '单测建议', description: '建议测试用例' },
  { id: 's4', name: '文档润色', description: '技术文档降重与格式' },
  { id: 's5', name: '翻译', description: '中英互译' },
]

type SearchRow =
  | { kind: 'wf'; wf: WorkflowSummary }
  | { kind: 'session' }
  | { kind: 'skill'; id: string; name: string; description: string }
  | { kind: 'settings' }

function buildSearchRows(q: string, workflows: WorkflowSummary[]): SearchRow[] {
  const t = q.trim().toLowerCase()
  const m = (s: string) => !t || s.toLowerCase().includes(t)
  const rows: SearchRow[] = []
  for (const wf of workflows) {
    if (m(wf.id) || m(wf.name) || m(wf.description)) rows.push({ kind: 'wf', wf })
  }
  if (m('新建会话') || m('新建') || m('新对话') || m('清空')) {
    rows.push({ kind: 'session' })
  }
  for (const s of SKILL_STUBS) {
    if (m(s.name) || m(s.id) || m(s.description)) {
      rows.push({ kind: 'skill', id: s.id, name: s.name, description: s.description })
    }
  }
  if (m('设置') || m('settings') || m('偏好') || m('api')) {
    rows.push({ kind: 'settings' })
  }
  const out: SearchRow[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const k =
      r.kind === 'session'
        ? 'session'
        : r.kind === 'settings'
          ? 'settings'
          : r.kind === 'skill'
            ? `sk-${r.id}`
            : `wf-${r.wf.id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

const CAT = {
  workflow: { bg: '#E6F1FB', fg: '#185FA5' },
  skill: { bg: '#EAF3DE', fg: '#3B6D11' },
  session: { bg: '#FAEEDA', fg: '#854F0B' },
  settings: { bg: '#F1EFE8', fg: '#5F5E5A' },
} as const

type Cat = keyof typeof CAT

function IconBox({ cat, children }: { cat: Cat; children: React.ReactNode }) {
  const c = CAT[cat]
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        background: c.bg,
        color: c.fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  )
}

const MAIN_ITEMS: (SlashCommandItem & { cat: Cat })[] = [
  { id: 'cat-workflow', category: 'workflow', name: 'Workflow', description: '启动一个工作流', badge: '', hasChildren: true, cat: 'workflow' },
  { id: 'cat-skill', category: 'skill', name: 'Skill', description: '执行一个 skill', badge: '5个', hasChildren: true, cat: 'skill' },
  { id: 'cat-session', category: 'session', name: '新建会话', description: '清空上下文开始新对话', hasChildren: false, cat: 'session' },
  { id: 'cat-settings', category: 'settings', name: '设置', description: '模型、API、偏好', hasChildren: false, cat: 'settings' },
]

/**
 * 主菜单 + 二级 + 搜索
 */
export function SlashMenu({ query, workflows, onSelectWorkflow, onSelectSession, onDismiss, onOpenSettings }: SlashMenuProps) {
  const [view, setView] = useState<'main' | 'workflow' | 'skill'>('main')
  const [hi, setHi] = useState(0)
  const searchMode = query.trim().length > 0
  const searchList = useMemo(() => (searchMode ? buildSearchRows(query, workflows) : []), [query, searchMode, workflows])

  const mainRows = useMemo(() => {
    const wfc = `${workflows.length}个`
    return MAIN_ITEMS.map((row, i) => (i === 0 ? { ...row, badge: wfc } : row))
  }, [workflows.length])

  const rowCount = useMemo(() => {
    if (searchMode) return searchList.length
    if (view === 'main') return 4
    if (view === 'workflow') return 1 + workflows.length
    return 1 + SKILL_STUBS.length
  }, [searchMode, view, searchList.length, workflows.length])

  useEffect(() => {
    setHi(0)
  }, [view, searchMode, query])

  const act = useCallback(
    (index: number) => {
      if (searchMode) {
        const row = searchList[index]
        if (!row) return
        if (row.kind === 'wf') onSelectWorkflow(row.wf)
        else if (row.kind === 'session') onSelectSession('new')
        else if (row.kind === 'settings') (onOpenSettings ?? onDismiss)()
        else onDismiss()
        return
      }
      if (view === 'main') {
        const item = mainRows[index]
        if (!item) return
        if (item.id === 'cat-workflow') setView('workflow')
        else if (item.id === 'cat-skill') setView('skill')
        else if (item.id === 'cat-session') onSelectSession('new')
        else if (item.id === 'cat-settings') (onOpenSettings ?? onDismiss)()
        return
      }
      if (view === 'workflow') {
        if (index === 0) {
          setView('main')
          return
        }
        const wf = workflows[index - 1]
        if (wf) onSelectWorkflow(wf)
        return
      }
      if (view === 'skill') {
        if (index === 0) {
          setView('main')
          return
        }
        onDismiss()
      }
    },
    [searchMode, searchList, view, mainRows, workflows, onSelectWorkflow, onSelectSession, onDismiss, onOpenSettings],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (searchMode || view === 'main') onDismiss()
        else setView('main')
        return
      }
      if (e.key === 'Backspace' && !searchMode && view !== 'main' && query === '') {
        e.preventDefault()
        e.stopPropagation()
        setView('main')
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setHi(h => (rowCount > 0 ? Math.min(h + 1, rowCount - 1) : 0))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setHi(h => (rowCount > 0 ? Math.max(h - 1, 0) : 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        act(hi)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onDismiss, searchMode, view, query, act, hi, rowCount])

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    marginBottom: 4,
    minWidth: 260,
    maxHeight: 280,
    overflowY: 'auto',
    borderRadius: 'var(--radius-md)',
    border: '0.5px solid var(--border-default)',
    background: 'var(--bg-primary)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  }

  if (searchMode) {
    return (
      <div onMouseDown={e => e.preventDefault()} style={panelStyle}>
        <div style={{ padding: '5px 10px 4px', fontSize: 10, color: 'var(--text-tertiary)' }}>搜索结果</div>
        {searchList.length === 0 && (
          <div style={{ padding: '16px 10px', textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)' }}>没有匹配的命令</div>
        )}
        {searchList.map((row, i) => (
          <button
            key={row.kind + (row.kind === 'wf' ? row.wf.id : row.kind === 'skill' ? row.id : row.kind)}
            type="button"
            onClick={() => act(i)}
            style={{
              display: 'flex',
              width: '100%',
              textAlign: 'left',
              alignItems: 'center',
              gap: 7,
              padding: '5px 10px',
              border: 'none',
              background: i === hi ? 'var(--bg-secondary)' : 'transparent',
              cursor: 'pointer',
            }}
          >
            {row.kind === 'wf' && (
              <>
                <IconBox cat="workflow">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M12 2L20 6V18L12 22L4 18V6L12 2Z" />
                  </svg>
                </IconBox>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{row.wf.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.3 }}>{row.wf.id}</div>
                </div>
              </>
            )}
            {row.kind === 'session' && (
              <>
                <IconBox cat="session">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                </IconBox>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>新建会话</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.3 }}>清空上下文开始新对话</div>
                </div>
              </>
            )}
            {row.kind === 'skill' && (
              <>
                <IconBox cat="skill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                </IconBox>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{row.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.3 }}>{row.description}</div>
                </div>
              </>
            )}
            {row.kind === 'settings' && (
              <>
                <IconBox cat="settings">
                  <span style={{ fontSize: 12, lineHeight: 1 }}>⚙</span>
                </IconBox>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>设置</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.3 }}>模型、API、偏好</div>
                </div>
              </>
            )}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div onMouseDown={e => e.preventDefault()} style={panelStyle}>
      {view === 'main' && (
        <>
          <div style={{ padding: '5px 10px 3px', fontSize: 10, color: 'var(--text-tertiary)' }}>输入关键词搜索，或选择分类</div>
          <div style={{ padding: '2px 10px 1px', fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>WORKFLOW</div>
          <RowMain item={mainRows[0]!} active={hi === 0} onClick={() => act(0)} />
          <div style={{ padding: '4px 10px 1px', fontSize: 10, color: 'var(--text-tertiary)' }}>工具</div>
          <RowMain item={mainRows[1]!} active={hi === 1} onClick={() => act(1)} />
          <div style={{ padding: '4px 10px 1px', fontSize: 10, color: 'var(--text-tertiary)' }}>会话</div>
          <RowMain item={mainRows[2]!} active={hi === 2} onClick={() => act(2)} />
          <div style={{ padding: '4px 10px 1px', fontSize: 10, color: 'var(--text-tertiary)' }}>系统</div>
          <RowMain item={mainRows[3]!} active={hi === 3} onClick={() => act(3)} />
        </>
      )}

      {view === 'workflow' && (
        <>
          <button
            type="button"
            onClick={() => setView('main')}
            style={{
              display: 'flex',
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              border: 'none',
              borderBottom: '0.5px solid var(--border-default)',
              background: hi === 0 ? 'var(--bg-secondary)' : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            ‹ 返回
          </button>
          <div style={{ padding: '3px 10px 2px', fontSize: 10, color: 'var(--text-tertiary)' }}>选择工作流</div>
          {workflows.map((wf, j) => {
            const i = 1 + j
            const chain = (wf.nodeIds ?? []).join(' → ')
            const needInputs = (wf.inputs?.length ?? 0) > 0
            return (
              <button
                key={wf.id}
                type="button"
                onClick={() => onSelectWorkflow(wf)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '5px 10px',
                  border: 'none',
                  background: i === hi ? 'var(--bg-secondary)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{wf.name}</span>
                  {needInputs && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 500,
                        padding: '0 5px',
                        borderRadius: 99,
                        background: '#E6F1FB',
                        color: '#185FA5',
                      }}
                    >
                      需填参数
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.35 }}>
                  {chain} · {wf.nodeCount} 个节点
                </div>
              </button>
            )
          })}
        </>
      )}

      {view === 'skill' && (
        <>
          <button
            type="button"
            onClick={() => setView('main')}
            style={{
              display: 'flex',
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              border: 'none',
              borderBottom: '0.5px solid var(--border-default)',
              background: hi === 0 ? 'var(--bg-secondary)' : 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            ‹ 返回
          </button>
          <div style={{ padding: '3px 10px 2px', fontSize: 10, color: 'var(--text-tertiary)' }}>选择 Skill</div>
          {SKILL_STUBS.map((s, j) => {
            const i = 1 + j
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onDismiss()}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '5px 10px',
                  border: 'none',
                  background: i === hi ? 'var(--bg-secondary)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 500 }}>{s.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.35 }}>{s.description}</div>
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}

function RowMain({
  item,
  active,
  onClick,
}: {
  item: SlashCommandItem & { cat: Cat }
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        gap: 7,
        padding: '5px 10px',
        border: 'none',
        background: active ? 'var(--bg-secondary)' : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {item.cat === 'workflow' && (
        <IconBox cat="workflow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M12 2L20 6V18L12 22L4 18V6L12 2Z" />
          </svg>
        </IconBox>
      )}
      {item.cat === 'skill' && (
        <IconBox cat="skill">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="12" cy="12" r="9" />
          </svg>
        </IconBox>
      )}
      {item.cat === 'session' && (
        <IconBox cat="session">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        </IconBox>
      )}
      {item.cat === 'settings' && (
        <IconBox cat="settings">
          <span style={{ fontSize: 12, lineHeight: 1 }}>⚙</span>
        </IconBox>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{item.name}</div>
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.3 }}>{item.description}</div>
      </div>
      {item.badge && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{item.badge}</span>}
      {item.hasChildren && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>›</span>}
    </button>
  )
}
