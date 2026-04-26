'use client'

export interface WorkflowStartedBubbleProps {
  workflowName: string
  nodeIds: string[]
  runId: string
}

export function WorkflowStartedBubble({ workflowName, nodeIds, runId }: WorkflowStartedBubbleProps) {
  return (
    <div
      title={runId}
      style={{
        maxWidth: 480,
        padding: '10px 12px 10px 11px',
        borderRadius: 'var(--radius-md)',
        border: '0.5px solid var(--border-default)',
        background: 'var(--bg-secondary)',
        borderLeft: '3px solid var(--accent)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>已启动：{workflowName}</div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {nodeIds.map((id, i) => (
          <span key={`${id}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span style={{ opacity: 0.6 }}>→</span>}
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: 'var(--text-tertiary)',
                display: 'inline-block',
                flexShrink: 0,
                opacity: 0.7,
              }}
            />
            <span style={{ fontFamily: 'var(--font-sans, monospace)' }}>{id}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
