'use client'

import { useState } from 'react'
import type { ToolCall } from '@/lib/types'

const ABBR: Record<string, string> = {
  Bash: 'bash', FileRead: 'read', FileEdit: 'edit', FileWrite: 'write',
  Glob: 'glob', Grep: 'grep', WebFetch: 'fetch', WebSearch: 'search',
  Agent: 'agent', TodoWrite: 'todo', AskUser: 'ask',
}

function inputSummary(name: string, input: Record<string, unknown>) {
  if (name === 'Bash') return String(input.command || '').slice(0, 72)
  const p = input.file_path || input.path || input.notebook_path
  if (p) return String(p).replace(/.*\//, '').slice(0, 60)
  if (name === 'Glob') return String(input.pattern || input.glob_pattern || '')
  if (name === 'Grep') return String(input.pattern || '').slice(0, 60)
  if (name === 'WebFetch') return String(input.url || '').replace(/^https?:\/\//, '').slice(0, 60)
  const vals = Object.values(input)
  return vals.length ? String(vals[0]).slice(0, 60) : ''
}

export default function ToolCallCard({ call: c }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const label   = ABBR[c.name] || c.name.toLowerCase()
  const summary = inputSummary(c.name, c.input)
  const result  = c.result ? (typeof c.result === 'string' ? c.result : JSON.stringify(c.result, null, 2)) : null
  const running = c.status === 'running'
  const error   = c.status === 'error'

  return (
    <div style={{
      border: `1px solid ${error ? 'rgba(150,50,50,.22)' : 'var(--border)'}`,
      borderRadius: 8,
      background: 'var(--surface-2)',
      overflow: 'hidden',
    }}>
      <button onClick={() => setOpen(v => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '6px 10px',
        background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left',
      }}>
        {/* tool name — label style */}
        <span className="label" style={{
          padding: '1px 5px',
          border: '1px solid var(--border-2)',
          borderRadius: 2,
          background: 'var(--bg)',
          flexShrink: 0,
        }}>
          {label}
        </span>

        {/* summary */}
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-geist-mono)',
          color: 'var(--text)', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {summary}
        </span>

        {/* status */}
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {running ? (
            <span style={{ display: 'flex', gap: 2 }}>
              {[0,1,2].map(i => (
                <span key={i} style={{
                  width: 2.5, height: 2.5, borderRadius: '50%', background: 'var(--text-2)',
                  display: 'inline-block',
                  animation: `dot .9s ease-in-out ${i*.14}s infinite`,
                }}/>
              ))}
            </span>
          ) : (
            <span className="label" style={{ color: error ? 'rgba(160,60,60,.8)' : 'var(--text-2)' }}>
              {error ? 'err' : 'ok'}
            </span>
          )}
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ color: 'var(--text-2)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .12s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '8px 10px' }}>
            <div className="label" style={{ marginBottom: 4 }}>Input</div>
            <pre style={{
              fontSize: 11, fontFamily: 'var(--font-geist-mono)',
              color: 'var(--text)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              maxHeight: 130, overflow: 'auto', margin: 0,
            }}>
              {JSON.stringify(c.input, null, 2)}
            </pre>
          </div>
          {result && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px' }}>
              <div className="label" style={{ marginBottom: 4, color: error ? 'rgba(160,60,60,.7)' : undefined }}>
                {error ? 'Error' : 'Output'}
              </div>
              <pre style={{
                fontSize: 11, fontFamily: 'var(--font-geist-mono)',
                color: error ? 'rgba(190,60,60,1)' : 'var(--text)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 200, overflow: 'auto', margin: 0,
              }}>
                {result.slice(0, 3000)}{result.length > 3000 ? '\n// …truncated' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
