'use client'

import { respondPermission } from '@/lib/api'
import type { PermissionRequest } from '@/lib/types'

interface Props {
  request: PermissionRequest
  onResolved: () => void
}

export default function PermissionDialog({ request, onResolved }: Props) {
  async function respond(decision: 'allow' | 'allow_always' | 'deny') {
    await respondPermission(request.requestId, decision)
    onResolved()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="fade-up card"
        style={{
          padding: 20,
          maxWidth: 440,
          width: '100%',
          margin: '0 16px',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
          <div
            style={{
              width: 32,
              height: 32,
              border: '1px solid var(--border)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
              style={{ color: 'var(--text-secondary)' }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
              Permission required
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              <code style={{ fontFamily: 'var(--font-geist-mono)', background: 'var(--bg-hover)', padding: '1px 5px', borderRadius: 3 }}>
                {request.toolName}
              </code>
              {' · '}
              <span style={{ color: request.riskLevel === 'high' ? '#cc6666' : request.riskLevel === 'medium' ? '#aa8844' : 'var(--text-muted)' }}>
                {request.riskLevel} risk
              </span>
            </div>
          </div>
        </div>

        {request.message && (
          <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, lineHeight: 1.6 }}>
            {request.message}
          </p>
        )}

        {Object.keys(request.input).length > 0 && (
          <pre
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--text)',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 10px',
              marginBottom: 14,
              overflow: 'auto',
              maxHeight: 120,
              margin: '0 0 14px',
            }}
          >
            {JSON.stringify(request.input, null, 2)}
          </pre>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" onClick={() => respond('deny')} style={{ flex: 1, justifyContent: 'center' }}>
            Deny
          </button>
          <button
            className="btn"
            onClick={() => respond('allow')}
            style={{ flex: 1, justifyContent: 'center', borderColor: 'var(--border-focus)', color: 'var(--text)' }}
          >
            Allow
          </button>
          <button
            className="btn"
            onClick={() => respond('allow_always')}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            Always
          </button>
        </div>
      </div>
    </div>
  )
}
