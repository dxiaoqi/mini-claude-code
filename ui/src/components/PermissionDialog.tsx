'use client'

import { respondPermission } from '@/lib/api'
import type { PermissionRequest } from '@/lib/types'

export default function PermissionDialog({ request: r, onResolved }: { request: PermissionRequest; onResolved: () => void }) {
  async function respond(d: 'allow' | 'allow_always' | 'deny') {
    await respondPermission(r.requestId, d); onResolved()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)',
    }}>
      <div className="a-up" style={{
        width: 400, background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8, padding: 20,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{
          fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase',
          color: 'var(--text-3)', marginBottom: 10, fontWeight: 600,
        }}>
          Permission required
        </div>
        <div style={{ marginBottom: 12 }}>
          <code style={{
            fontSize: 13, fontFamily: 'var(--font-geist-mono)',
            color: 'var(--text)',
          }}>
            {r.toolName}
          </code>
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 8 }}>
            {r.riskLevel} risk
          </span>
        </div>
        {r.message && (
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.55 }}>
            {r.message}
          </p>
        )}
        {Object.keys(r.input).length > 0 && (
          <pre style={{
            fontSize: 11, fontFamily: 'var(--font-geist-mono)',
            color: 'var(--text)', background: 'var(--bg)',
            border: '1px solid var(--border)', borderRadius: 4,
            padding: '8px 10px', marginBottom: 14,
            overflow: 'auto', maxHeight: 110,
          }}>
            {JSON.stringify(r.input, null, 2)}
          </pre>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { label: 'Deny', d: 'deny' as const },
            { label: 'Allow once', d: 'allow' as const, primary: true },
            { label: 'Always', d: 'allow_always' as const },
          ].map(btn => (
            <button key={btn.d} onClick={() => respond(btn.d)} style={{
              flex: 1, padding: '7px 0', fontSize: 12,
              fontWeight: btn.primary ? 600 : 400,
              letterSpacing: '.02em',
              border: `1px solid ${btn.primary ? 'var(--ink)' : 'var(--border)'}`,
              borderRadius: 4,
              background: btn.primary ? 'var(--ink)' : 'transparent',
              color: btn.primary ? 'var(--paper)' : 'var(--text-2)',
              cursor: 'pointer', transition: 'opacity .12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '.75')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
