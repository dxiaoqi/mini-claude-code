'use client'

import { useState } from 'react'
import { X, LayoutGrid } from 'lucide-react'
import { WorkflowDAGCard } from '@/components/workflow/WorkflowDAGCard'
import type { WorkflowTask } from '@/lib/types'

export interface ProjectPanelProps {
  open: boolean
  onClose: () => void
  tasks: WorkflowTask[]
}

function chainPreview(task: WorkflowTask): string {
  if (!task.dagState) return '…'
  const ids = task.nodeIds?.length
    ? task.nodeIds
    : Object.keys(task.dagState.nodeStates)
  if (!ids.length) return '…'
  return ids
    .map(id => {
      const s = task.dagState!.nodeStates[id]
      if (!s) return `${id}·?`
      if (s.status === 'done') return `${id}✓`
      if (s.status === 'failed') return `${id}✗`
      if (s.status === 'running') return `${id}…`
      if (s.status === 'waiting') return `${id}?`
      return id
    })
    .join(' ')
}

function statusLabel(s: WorkflowTask['status']): { text: string; color: string } {
  if (s === 'running') return { text: '运行中', color: 'var(--info)' }
  if (s === 'done') return { text: '已完成', color: 'var(--success)' }
  return { text: '已失败', color: 'var(--danger)' }
}

export function ProjectPanel({ open, onClose, tasks }: ProjectPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (!open) return null

  return (
    <div
        role="dialog"
        aria-label="工作流项目"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 380,
          maxWidth: '92vw',
          height: '100vh',
          zIndex: 10020,
          background: 'var(--bg-primary)',
          borderLeft: '0.5px solid var(--border-default)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderBottom: '0.5px solid var(--border-default)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600 }}>项目</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              padding: 4,
            }}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '10px 12px 12px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              color: 'var(--text-tertiary)',
              marginBottom: 10,
            }}
          >
            WORKFLOW
          </div>
          {tasks.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>暂无工作流任务</p>
          )}
          {tasks.map(t => {
            const exp = expanded[t.runId] ?? false
            const { text: stText, color: stColor } = statusLabel(t.status)
            return (
              <div key={t.runId} style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => setExpanded(p => ({ ...p, [t.runId]: !exp }))}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '0.5px solid var(--border-default)',
                    background: 'var(--bg-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t.workflowName}</span>
                    <span style={{ fontSize: 11, color: stColor, flexShrink: 0 }}>{stText}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.35, wordBreak: 'break-all' }}>
                    {chainPreview(t)}
                  </div>
                </button>
                {exp && t.dagState && (
                  <div style={{ marginTop: 8 }}>
                    <WorkflowDAGCard
                      docked
                      readOnly
                      initialCollapsed
                      workflow={t.workflow}
                      dagState={t.dagState}
                      formValues={t.dagState.inputValues}
                      formErrors={{}}
                      formSubmitting={false}
                      onFormChange={() => {}}
                      onFormSubmit={() => {}}
                      onFormCancel={() => {}}
                      onHILDecide={() => {}}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
  )
}

export function ProjectPanelHeaderButton({
  onClick,
  runningCount,
}: {
  onClick: () => void
  runningCount: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--text-primary)',
        background: 'var(--bg-secondary)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 8,
        cursor: 'pointer',
      }}
    >
      <LayoutGrid size={14} strokeWidth={2} color="var(--text-secondary)" />
      项目
      {runningCount > 0 && (
        <span
          style={{
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: '18px',
            textAlign: 'center',
            borderRadius: 99,
            background: 'var(--info-bg)',
            color: 'var(--info)',
          }}
        >
          {runningCount}
        </span>
      )}
    </button>
  )
}
