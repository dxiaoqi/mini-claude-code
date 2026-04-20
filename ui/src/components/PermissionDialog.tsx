'use client'

import { useState, useEffect } from 'react'
import { ShieldAlert, ShieldCheck, X } from 'lucide-react'

export interface PermissionRequest {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  message: string
  riskLevel: string
}

type Decision = 'allow' | 'allow_always' | 'deny'

interface Props {
  request: PermissionRequest
  onRespond: (decision: Decision) => void
}

export function PermissionDialog({ request, onRespond }: Props) {
  const [hovered, setHovered] = useState<Decision | null>(null)
  const isHigh = request.riskLevel === 'high'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRespond('deny')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRespond, request.requestId])

  const inputStr = (() => {
    try { return JSON.stringify(request.input, null, 2) } catch { return String(request.input) }
  })()

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
      onClick={() => onRespond('deny')}
      role="presentation"
    >
      <div
        style={{
          background: 'var(--bg-primary)',
          border: '0.5px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
          maxWidth: 480,
          width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="perm-dialog-title"
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{
            flexShrink: 0,
            width: 36, height: 36,
            borderRadius: 'var(--radius-md)',
            background: isHigh ? 'rgba(239,68,68,0.1)' : 'rgba(234,179,8,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ShieldAlert width={18} height={18} style={{ color: isHigh ? '#ef4444' : '#eab308' }} />
          </div>
          <div style={{ flex: 1 }}>
            <p id="perm-dialog-title" style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              权限请求
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Agent 请求执行工具：<code style={{
                background: 'var(--bg-secondary)',
                padding: '1px 5px',
                borderRadius: 4,
                fontSize: '11.5px',
                color: 'var(--accent)',
              }}>{request.toolName}</code>
            </p>
          </div>
        </div>

        {/* Message */}
        {request.message && (
          <p style={{
            fontSize: '12.5px',
            color: 'var(--text-secondary)',
            marginBottom: 12,
            lineHeight: 1.6,
          }}>
            {request.message}
          </p>
        )}

        {/* Input preview */}
        <pre style={{
          background: 'var(--bg-secondary)',
          border: '0.5px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 12px',
          fontSize: '11px',
          color: 'var(--text-tertiary)',
          overflowX: 'auto',
          maxHeight: 140,
          overflowY: 'auto',
          marginBottom: 20,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontFamily: 'var(--font-mono)',
        }}>
          {inputStr}
        </pre>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <PermBtn
            label="拒绝"
            variant="deny"
            hovered={hovered === 'deny'}
            onHover={setHovered}
            onClick={() => onRespond('deny')}
            icon={<X width={11} height={11} />}
          />
          <PermBtn
            label="允许一次"
            variant="allow"
            hovered={hovered === 'allow'}
            onHover={setHovered}
            onClick={() => onRespond('allow')}
            icon={<ShieldCheck width={11} height={11} />}
          />
          <PermBtn
            label="始终允许"
            variant="allow_always"
            hovered={hovered === 'allow_always'}
            onHover={setHovered}
            onClick={() => onRespond('allow_always')}
            icon={<ShieldCheck width={11} height={11} />}
          />
        </div>
      </div>
    </div>
  )
}

function PermBtn({ label, variant, hovered, onHover, onClick, icon }: {
  label: string
  variant: Decision
  hovered: boolean
  onHover: (v: Decision | null) => void
  onClick: () => void
  icon: React.ReactNode
}) {
  const isDeny = variant === 'deny'
  const isAlwaysAllow = variant === 'allow_always'

  const bg = hovered
    ? isDeny ? 'rgba(239,68,68,0.15)' : isAlwaysAllow ? 'var(--accent)' : 'var(--bg-secondary)'
    : isDeny ? 'transparent' : isAlwaysAllow ? 'var(--accent)' : 'transparent'

  const color = hovered
    ? isDeny ? '#ef4444' : isAlwaysAllow ? '#fff' : 'var(--text-primary)'
    : isDeny ? 'var(--text-tertiary)' : isAlwaysAllow ? '#fff' : 'var(--text-secondary)'

  const border = isDeny
    ? `0.5px solid ${hovered ? '#ef4444' : 'var(--border-default)'}`
    : isAlwaysAllow
      ? '0.5px solid var(--accent)'
      : `0.5px solid ${hovered ? 'var(--border-hover)' : 'var(--border-default)'}`

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(variant)}
      onMouseLeave={() => onHover(null)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '6px 12px',
        borderRadius: 'var(--radius-md)',
        border,
        background: bg,
        color,
        fontSize: '12px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 150ms ease',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
