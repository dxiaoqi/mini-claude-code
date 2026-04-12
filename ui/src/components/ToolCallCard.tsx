'use client'

import { useState } from 'react'
import type { ToolCall } from '@/lib/types'

const TOOL_LABELS: Record<string, string> = {
  Bash: 'bash',
  FileRead: 'read',
  FileEdit: 'edit',
  FileWrite: 'write',
  Glob: 'glob',
  Grep: 'grep',
  WebFetch: 'fetch',
  WebSearch: 'search',
  Agent: 'agent',
  TodoWrite: 'todo',
  AskUser: 'ask',
  Skill: 'skill',
}

function StatusIndicator({ status }: { status: ToolCall['status'] }) {
  if (status === 'running') {
    return (
      <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
        <span className="flex gap-0.5">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="inline-block w-1 h-1 rounded-full"
              style={{
                background: 'var(--text-muted)',
                animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </span>
        <span style={{ fontSize: 11 }}>running</span>
      </span>
    )
  }
  if (status === 'error') {
    return <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>✗ error</span>
  }
  return <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>✓ done</span>
}

function getInputSummary(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return String(input.command || '').slice(0, 80)
  if (name === 'FileRead' || name === 'FileEdit' || name === 'FileWrite') {
    return String(input.file_path || input.path || '').replace(/.*\//, '')
  }
  if (name === 'Glob') return String(input.pattern || input.glob_pattern || '')
  if (name === 'Grep') return String(input.pattern || '')
  if (name === 'WebFetch') return String(input.url || '').replace(/^https?:\/\//, '').slice(0, 60)
  if (name === 'TodoWrite') {
    const todos = input.todos as Array<{ content: string; status: string }> | undefined
    if (todos?.length) return todos.map(t => t.content.slice(0, 20)).join(', ')
  }
  const vals = Object.values(input)
  if (vals.length === 0) return ''
  return String(vals[0]).slice(0, 60)
}

export default function ToolCallCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const label = TOOL_LABELS[call.name] || call.name.toLowerCase()
  const summary = getInputSummary(call.name, call.input)
  const resultText = call.result
    ? typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)
    : null

  const borderColor = call.status === 'error' ? 'rgba(180,50,50,0.3)' : 'var(--border)'
  const bgColor = call.status === 'error' ? 'rgba(180,50,50,0.04)' : 'var(--bg-elevated)'

  return (
    <div
      className="fade-up"
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--radius-sm)',
        background: bgColor,
        transition: 'border-color 0.15s',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          cursor: 'pointer',
          background: 'none',
          border: 'none',
          color: 'inherit',
        }}
      >
        {/* Tool label */}
        <code
          className="mono"
          style={{
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 3,
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            background: 'var(--bg)',
            flexShrink: 0,
          }}
        >
          {label}
        </code>

        {/* Summary */}
        <span
          className="mono"
          style={{
            fontSize: 12,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {summary}
        </span>

        {/* Status + toggle */}
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusIndicator status={call.status} />
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            style={{
              color: 'var(--text-muted)',
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
            }}
          >
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* Input */}
          <div style={{ padding: '8px 10px' }}>
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--text-muted)',
                marginBottom: 4,
              }}
            >
              Input
            </div>
            <pre
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--text)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 160,
                overflow: 'auto',
                margin: 0,
              }}
            >
              {JSON.stringify(call.input, null, 2)}
            </pre>
          </div>

          {/* Result */}
          {resultText && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px' }}>
              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: call.isError ? 'rgba(200,80,80,0.8)' : 'var(--text-muted)',
                  marginBottom: 4,
                }}
              >
                {call.isError ? 'Error' : 'Result'}
              </div>
              <pre
                className="mono"
                style={{
                  fontSize: 11,
                  color: call.isError ? 'rgba(220,100,100,1)' : 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 200,
                  overflow: 'auto',
                  margin: 0,
                }}
              >
                {resultText.slice(0, 3000)}{resultText.length > 3000 ? '\n…(truncated)' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
