'use client'

import { useEffect, useMemo, useState } from 'react'
import type { WorkflowSummary } from '@/lib/types'

export interface SlashCommandMenuProps {
  open: boolean
  query: string
  workflows: WorkflowSummary[]
  onSelect: (workflow: WorkflowSummary) => void
  onDismiss: () => void
}

function filterWorkflows(wfs: WorkflowSummary[], q: string): WorkflowSummary[] {
  const t = q.trim().toLowerCase()
  if (!t) return wfs
  return wfs.filter(w => w.id.toLowerCase().includes(t) || w.name.toLowerCase().includes(t))
}

function chainLabel(nodeIds: string[]): string {
  if (!nodeIds.length) return '—'
  return nodeIds.join(' → ')
}

/**
 * 浮层菜单：/ 触发，键盘与点击选择 workflow
 */
export function SlashCommandMenu({ open, query, workflows, onSelect, onDismiss }: SlashCommandMenuProps) {
  const filtered = useMemo(() => filterWorkflows(workflows, query), [workflows, query])
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    setHighlight(0)
  }, [query, open, filtered.length])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onDismiss()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setHighlight(h => (filtered.length ? Math.min(h + 1, filtered.length - 1) : 0))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setHighlight(h => (filtered.length ? Math.max(h - 1, 0) : 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const w = filtered[highlight]
        if (w) onSelect(w)
        return
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, filtered, highlight, onSelect, onDismiss])

  if (!open) return null

  return (
    <div
      onMouseDown={e => e.preventDefault()}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: '100%',
        marginBottom: 6,
        maxHeight: 320,
        overflowY: 'auto',
        borderRadius: 'var(--radius-md)',
        border: '0.5px solid var(--border-default)',
        background: 'var(--bg-primary)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px 6px',
          borderBottom: '0.5px solid var(--border-default)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>workflow</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>ESC 关闭</span>
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--text-tertiary)' }}>没有匹配的 workflow</div>
      ) : (
        filtered.map((w, i) => (
          <button
            key={w.id}
            type="button"
            onClick={() => onSelect(w)}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
              width: '100%',
              textAlign: 'left',
              border: 'none',
              background: i === highlight ? 'var(--bg-secondary)' : 'transparent',
              cursor: 'pointer',
              padding: '10px 12px',
              borderBottom: '0.5px solid var(--border-default)',
            }}
            onMouseEnter={() => setHighlight(i)}
          >
            <span
              aria-hidden
              style={{
                width: 12,
                height: 12,
                marginTop: 3,
                flexShrink: 0,
                border: '1.5px solid var(--accent)',
                transform: 'rotate(30deg) skewX(-20deg)',
                display: 'inline-block',
                boxSizing: 'border-box',
                opacity: 0.8,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 4 }}>{w.name}</div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                  lineHeight: 1.4,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chainLabel(w.nodeIds)}</span>
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 99,
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {w.nodeCount} 节点
                </span>
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  )
}
