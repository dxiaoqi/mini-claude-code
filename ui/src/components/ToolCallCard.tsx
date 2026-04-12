'use client'

import { useState } from 'react'
import type { ToolCall } from '@/lib/types'

const ABBR: Record<string, string> = {
  Bash: 'bash', FileRead: 'read', FileEdit: 'edit', FileWrite: 'write',
  Glob: 'glob', Grep: 'grep', WebFetch: 'fetch', WebSearch: 'search',
  Agent: 'agent', TodoWrite: 'todo', AskUser: 'ask',
}

function summary(name: string, input: Record<string, unknown>) {
  if (name === 'Bash') return String(input.command || '').slice(0, 72)
  const path = input.file_path || input.path || input.notebook_path
  if (path) return String(path).replace(/.*\//, '').slice(0, 60)
  if (name === 'Glob') return String(input.pattern || input.glob_pattern || '')
  if (name === 'Grep') return String(input.pattern || '').slice(0, 60)
  if (name === 'WebFetch') return String(input.url || '').replace(/^https?:\/\//, '').slice(0, 60)
  const vals = Object.values(input)
  return vals.length ? String(vals[0]).slice(0, 60) : ''
}

export default function ToolCallCard({ call: c }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const label = ABBR[c.name] || c.name.toLowerCase()
  const text  = c.result ? (typeof c.result === 'string' ? c.result : JSON.stringify(c.result, null, 2)) : null

  const running = c.status === 'running'
  const error   = c.status === 'error'

  return (
    <div
      style={{
        border: `1px solid ${error ? 'rgba(160,50,50,.3)' : 'var(--border)'}`,
        borderRadius: 5, overflow: 'hidden',
        background: error ? 'rgba(160,50,50,.03)' : 'var(--surface)',
        transition: 'border-color .12s',
      }}
    >
      {/* row */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '5px 9px',
          background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left',
        }}
      >
        <code style={{
          fontSize: 10, padding: '1px 5px', borderRadius: 3,
          border: '1px solid var(--border)', background: 'var(--bg)',
          color: 'var(--text-2)', flexShrink: 0,
          fontFamily: 'var(--font-geist-mono)',
        }}>
          {label}
        </code>
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-geist-mono)',
          color: 'var(--text)', flex: 1, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {summary(c.name, c.input)}
        </span>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
          {running && (
            <span style={{ display: 'flex', gap: 2 }}>
              {[0,1,2].map(i => (
                <span key={i} style={{
                  width: 3, height: 3, borderRadius: '50%',
                  background: 'var(--text-3)', display: 'inline-block',
                  animation: `dot .9s ease-in-out ${i*.15}s infinite`,
                }}/>
              ))}
            </span>
          )}
          {!running && (
            <span style={{ fontSize: 10, color: error ? 'rgba(180,60,60,.9)' : 'var(--text-3)' }}>
              {error ? '✗' : '✓'}
            </span>
          )}
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .13s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '7px 9px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>Input</div>
            <pre style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 140, overflow: 'auto', margin: 0, fontFamily: 'var(--font-geist-mono)' }}>
              {JSON.stringify(c.input, null, 2)}
            </pre>
          </div>
          {text && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '7px 9px' }}>
              <div style={{ fontSize: 10, color: error ? 'rgba(180,60,60,.8)' : 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>
                {error ? 'Error' : 'Output'}
              </div>
              <pre style={{ fontSize: 11, color: error ? 'rgba(200,80,80,1)' : 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto', margin: 0, fontFamily: 'var(--font-geist-mono)' }}>
                {text.slice(0, 3000)}{text.length > 3000 ? '\n…' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
