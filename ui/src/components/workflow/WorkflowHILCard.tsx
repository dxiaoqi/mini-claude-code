'use client'

export interface WorkflowHILCardProps {
  nodeId: string
  question: string
  options: Array<{ id: string; label: string }>
  onDecide: (decision: 'approve' | 'reject') => void
  decided: boolean
  decision?: 'approve' | 'reject'
  decidedTimeLabel?: string
}

function optionDecision(opt: { id: string; label: string }, index: number): 'approve' | 'reject' {
  if (opt.id === 'approve' || opt.id === 'reject') return opt.id
  return index === 0 ? 'approve' : 'reject'
}

export function WorkflowHILCard({
  question,
  options,
  onDecide,
  decided,
  decision,
  decidedTimeLabel,
}: WorkflowHILCardProps) {
  return (
    <div
      style={{
        maxWidth: 480,
        padding: '12px 14px',
        borderRadius: 'var(--radius-md)',
        border: '0.5px solid var(--border-default)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--warning-fg, #b45309)',
            background: 'var(--warning-bg, rgba(245, 158, 11, 0.2))',
            padding: '2px 8px',
            borderRadius: 99,
            letterSpacing: '0.02em',
          }}
        >
          需要确认
        </span>
      </div>
      <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>{question}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map((opt, i) => {
          const d = optionDecision(opt, i)
          const selected = decided && decision === d
          const othersGrey = decided && !selected
          const green = d === 'approve'
          return (
            <button
              key={opt.id}
              type="button"
              disabled={decided}
              onClick={() => onDecide(d)}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                borderRadius: 'var(--radius-sm)',
                border: '0.5px solid var(--border-default)',
                background: selected
                  ? (green
                    ? 'rgba(34, 197, 94, 0.25)'
                    : 'rgba(239, 68, 68, 0.25)')
                  : othersGrey
                    ? 'var(--bg-tertiary)'
                    : 'var(--bg-primary)',
                color: selected ? (green ? 'var(--color-text-success, #16a34a)' : 'var(--color-text-danger, #dc2626)') : 'var(--text-primary)',
                borderColor: selected
                  ? (green ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)')
                  : 'var(--border-default)',
                cursor: decided ? 'default' : 'pointer',
                opacity: othersGrey ? 0.5 : 1,
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      {decided && decidedTimeLabel && (
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>已于 {decidedTimeLabel} 确认</p>
      )}
    </div>
  )
}
