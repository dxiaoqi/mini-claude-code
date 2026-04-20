'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Check, AlertCircle, Wrench } from 'lucide-react'

export interface ToolCallItem {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: unknown
  isError?: boolean
}

interface Props {
  toolCall: ToolCallItem
}

export function ToolCallCard({ toolCall }: Props) {
  const [expanded, setExpanded] = useState(false)

  const isDone = toolCall.status === 'done' || toolCall.status === 'error'
  const isError = toolCall.isError || toolCall.status === 'error'

  const inputStr = (() => {
    try { return JSON.stringify(toolCall.input, null, 2) } catch { return String(toolCall.input) }
  })()

  const resultStr = (() => {
    if (toolCall.result === undefined) return ''
    if (typeof toolCall.result === 'string') {
      return toolCall.result.length > 400
        ? toolCall.result.slice(0, 400) + '…'
        : toolCall.result
    }
    try { return JSON.stringify(toolCall.result, null, 2) } catch { return String(toolCall.result) }
  })()

  return (
    <div style={{
      borderBottom: `0.5px solid var(--border-default)`,
      background: 'var(--bg-secondary)',
      overflow: 'hidden',
    }}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {/* Status icon */}
        {!isDone
          ? <Loader2 width={12} height={12} style={{ color: 'var(--accent)', animation: 'spin-accent 0.7s linear infinite', flexShrink: 0 }} />
          : isError
            ? <AlertCircle width={12} height={12} style={{ color: '#ef4444', flexShrink: 0 }} />
            : <Check width={12} height={12} style={{ color: 'var(--success, #22c55e)', flexShrink: 0 }} />
        }

        {/* Tool icon + name */}
        <Wrench width={11} height={11} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <span style={{ fontSize: '11.5px', fontWeight: 500, color: 'var(--text-secondary)', flex: 1, fontFamily: 'var(--font-mono)' }}>
          {toolCall.name}
        </span>

        {/* Status text */}
        <span style={{ fontSize: '10.5px', color: isError ? '#ef4444' : isDone ? 'var(--text-tertiary)' : 'var(--accent)' }}>
          {!isDone ? '运行中…' : isError ? '失败' : '完成'}
        </span>

        {/* Expand chevron */}
        {expanded
          ? <ChevronDown width={11} height={11} style={{ color: 'var(--text-disabled)', flexShrink: 0 }} />
          : <ChevronRight width={11} height={11} style={{ color: 'var(--text-disabled)', flexShrink: 0 }} />
        }
      </button>

      {/* Expanded content */}
      {expanded && (
        <div style={{ borderTop: '0.5px solid var(--border-default)', padding: '8px 10px' }}>
          {/* Input */}
          <p style={{ fontSize: '10px', color: 'var(--text-disabled)', marginBottom: 4, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            输入
          </p>
          <pre style={{
            fontSize: '11px',
            color: 'var(--text-tertiary)',
            background: 'var(--bg-primary)',
            border: '0.5px solid var(--border-default)',
            borderRadius: 'var(--radius-sm, 4px)',
            padding: '6px 8px',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            marginBottom: resultStr ? 10 : 0,
            fontFamily: 'var(--font-mono)',
            maxHeight: 200,
            overflowY: 'auto',
          }}>
            {inputStr}
          </pre>

          {/* Result */}
          {resultStr && (
            <>
              <p style={{ fontSize: '10px', color: 'var(--text-disabled)', marginBottom: 4, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                结果
              </p>
              <pre style={{
                fontSize: '11px',
                color: isError ? '#ef4444' : 'var(--text-tertiary)',
                background: 'var(--bg-primary)',
                border: `0.5px solid ${isError ? 'rgba(239,68,68,0.3)' : 'var(--border-default)'}`,
                borderRadius: 'var(--radius-sm, 4px)',
                padding: '6px 8px',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: 'var(--font-mono)',
                maxHeight: 200,
                overflowY: 'auto',
              }}>
                {resultStr}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
