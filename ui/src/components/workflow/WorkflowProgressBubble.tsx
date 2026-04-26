'use client'

import { useState } from 'react'

export interface WorkflowProgressBubbleProps {
  nodeId: string
  nodeIndex: number
  totalNodes: number
  result?: string
  status: 'running' | 'done' | 'failed'
  error?: string
}

export function WorkflowProgressBubble({
  nodeId,
  nodeIndex,
  totalNodes,
  result,
  status,
  error,
}: WorkflowProgressBubbleProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      style={{
        maxWidth: 480,
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        border: '0.5px solid var(--border-default)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ width: 20, display: 'flex', justifyContent: 'center', paddingTop: 2 }}>
          {status === 'running' && (
            <span
              style={{
                display: 'inline-block',
                width: 16,
                height: 16,
                border: '2px solid var(--border-default)',
                borderTopColor: 'var(--accent)',
                borderRadius: '50%',
                animation: 'spin-accent 0.8s linear infinite',
              }}
            />
          )}
          {status === 'done' && (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'var(--color-text-success, #22c55e)',
                display: 'inline-block',
                marginTop: 3,
              }}
            />
          )}
          {status === 'failed' && (
            <span style={{ color: 'var(--color-text-danger, #ef4444)', fontSize: 16, lineHeight: 1 }}>×</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            节点 {nodeIndex + 1} / {totalNodes} · {nodeId}
          </div>
          {status === 'done' && result !== undefined && (
            <div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  lineHeight: 1.5,
                  whiteSpace: expanded ? 'pre-wrap' : 'normal',
                  wordBreak: 'break-word',
                  maxHeight: expanded ? 'none' : '4.5em',
                  overflow: expanded ? 'visible' : 'hidden',
                }}
              >
                {result}
              </div>
              {result && result.length > 200 && (
                <button
                  type="button"
                  onClick={() => setExpanded(e => !e)}
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--accent)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {expanded ? '收起' : '展开'}
                </button>
              )}
            </div>
          )}
          {status === 'failed' && error && (
            <div style={{ fontSize: 13, color: 'var(--error, #ef4444)', lineHeight: 1.5 }}>{error}</div>
          )}
        </div>
      </div>
    </div>
  )
}
