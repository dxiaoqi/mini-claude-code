'use client'

import { useEffect, useState } from 'react'
import type { WorkflowToast } from '@/lib/types'

const TRANSITION_MS = 280

export interface WorkflowToastStackProps {
  toasts: WorkflowToast[]
  onHILDecide: (toastId: string, runId: string, nodeId: string, decision: 'approve' | 'reject') => void
  onDismiss: (toastId: string) => void
}

export function WorkflowToastStack({ toasts, onHILDecide, onDismiss }: WorkflowToastStackProps) {
  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 10040,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 10,
        maxWidth: 380,
        pointerEvents: 'none',
      }}
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onHILDecide={onHILDecide} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastItem({
  toast: t,
  onHILDecide,
  onDismiss,
}: {
  toast: WorkflowToast
  onHILDecide: WorkflowToastStackProps['onHILDecide']
  onDismiss: WorkflowToastStackProps['onDismiss']
}) {
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (t.type === 'hil') return
    const ms = t.autoCloseMs
    if (ms == null || ms <= 0) return
    const id = setTimeout(() => {
      setClosing(true)
      setTimeout(() => onDismiss(t.id), TRANSITION_MS)
    }, ms)
    return () => clearTimeout(id)
  }, [t.id, t.type, t.autoCloseMs, onDismiss])

  const exit = () => {
    setClosing(true)
    setTimeout(() => onDismiss(t.id), TRANSITION_MS)
  }

  const isHil = t.type === 'hil'
  const isDone = t.type === 'done'
  const isErr = t.type === 'error'

  return (
    <div
      style={{
        pointerEvents: 'auto',
        maxWidth: 360,
        borderRadius: 'var(--radius-md)',
        border: '0.5px solid var(--border-default)',
        padding: '10px 12px',
        background: isHil
          ? 'var(--warning-bg)'
          : isErr
            ? 'var(--danger-bg)'
            : 'var(--success-bg)',
        color: 'var(--text-primary)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        transform: closing ? 'translateX(110%)' : 'translateX(0)',
        opacity: closing ? 0 : 1,
        transition: `transform ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
          {isHil && '⚠ 需要确认 · '}
          {isDone && '✓ '}
          {isErr && '✗ '}
          {t.workflowName}
        </div>
        {!isHil && (
          <button
            type="button"
            onClick={exit}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
            }}
            aria-label="关闭"
          >
            ×
          </button>
        )}
      </div>
      {isHil && t.question && (
        <p style={{ fontSize: 13, margin: '0 0 10px', lineHeight: 1.5, color: 'var(--text-primary)' }}>{t.question}</p>
      )}
      {isDone && <p style={{ fontSize: 12, margin: 0, color: 'var(--text-secondary)' }}>已将结论添加到对话</p>}
      {isErr && t.errorMessage && (
        <p style={{ fontSize: 12, margin: 0, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{t.errorMessage}</p>
      )}
      {isHil && t.nodeId && t.options && t.options.length > 0 && !t.decided && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {t.options.map((opt, i) => {
            const d =
              opt.id === 'approve' || opt.id === 'reject' ? opt.id : i === 0 ? 'approve' : 'reject'
            const g = d === 'approve'
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onHILDecide(t.id, t.runId, t.nodeId!, d as 'approve' | 'reject')}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: g ? '1px solid #97C459' : '1px solid #B4B2A9',
                  background: g ? 'rgba(151, 196, 89, 0.2)' : 'rgba(255,255,255,0.45)',
                  color: g ? '#2d5a0a' : '#4a2f18',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
