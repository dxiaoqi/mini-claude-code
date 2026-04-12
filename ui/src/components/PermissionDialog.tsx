'use client'

import { respondPermission } from '@/lib/api'
import type { PermissionRequest } from '@/lib/types'

export default function PermissionDialog({ request: r, onResolved }: { request: PermissionRequest; onResolved: () => void }) {
  async function respond(d: 'allow' | 'allow_always' | 'deny') {
    await respondPermission(r.requestId, d); onResolved()
  }

  const btn = (label: string, d: 'allow' | 'allow_always' | 'deny', primary?: boolean) => (
    <button
      onClick={() => respond(d)}
      style={{
        flex: 1, padding: '7px 0', fontSize: 12, fontWeight: primary ? 500 : 400,
        border: '1px solid var(--border)', borderRadius: 5,
        background: primary ? 'var(--text)' : 'transparent',
        color: primary ? 'var(--bg)' : 'var(--text-2)',
        cursor: 'pointer', transition: 'opacity .12s',
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '.8')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
    >
      {label}
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(3px)' }}>
      <div className="in-up" style={{ width: 400, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>Permission required</div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 12 }}>
          <code style={{ fontFamily: 'var(--font-geist-mono)', background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>{r.toolName}</code>
          {' · '}<span style={{ color: r.riskLevel === 'high' ? 'rgba(200,70,70,1)' : 'var(--text-3)' }}>{r.riskLevel} risk</span>
        </div>
        {r.message && <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, lineHeight: 1.55 }}>{r.message}</p>}
        {Object.keys(r.input).length > 0 && (
          <pre style={{ fontSize: 11, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '7px 9px', marginBottom: 14, overflow: 'auto', maxHeight: 110, fontFamily: 'var(--font-geist-mono)' }}>
            {JSON.stringify(r.input, null, 2)}
          </pre>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {btn('Deny', 'deny')}
          {btn('Allow once', 'allow', true)}
          {btn('Always allow', 'allow_always')}
        </div>
      </div>
    </div>
  )
}
