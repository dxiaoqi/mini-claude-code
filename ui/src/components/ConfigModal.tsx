'use client'

import { useState, useEffect } from 'react'
import { getConfig, updateConfig, type WorkspaceConfig } from '@/lib/api'

export default function ConfigModal({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg]   = useState<WorkspaceConfig>({})
  const [draft, setDraft] = useState<WorkspaceConfig>({})
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  useEffect(() => {
    getConfig().then(c => { setCfg(c); setDraft(c) })
  }, [])

  const u = (patch: Partial<WorkspaceConfig>) => setDraft(d => ({ ...d, ...patch }))
  const ua = (patch: Partial<WorkspaceConfig['api']>) => setDraft(d => ({ ...d, api: { ...d.api, ...patch } }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg)

  async function save() {
    setSaving(true)
    await updateConfig(draft)
    setCfg(draft); setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  const row = (label: string, children: React.ReactNode, hint?: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'start', gap: 10 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text)', paddingTop: 7 }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>{hint}</div>}
      </div>
      {children}
    </div>
  )

  const input = (val: string, onChange: (v: string) => void, placeholder?: string, type = 'text') => (
    <input
      type={type}
      value={val}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      style={{
        width: '100%', padding: '6px 9px',
        fontSize: 12, fontFamily: 'var(--font-geist-mono)',
        background: 'var(--bg)', color: 'var(--text)',
        border: '1px solid var(--border)', borderRadius: 5,
        outline: 'none', transition: 'border-color .12s',
      }}
      onFocus={e => (e.target.style.borderColor = 'var(--border-mid)')}
      onBlur={e  => (e.target.style.borderColor = 'var(--border)')}
    />
  )

  const select = (val: string, onChange: (v: string) => void, options: [string, string][]) => (
    <select
      value={val}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', padding: '6px 9px',
        fontSize: 12, background: 'var(--bg)', color: 'var(--text)',
        border: '1px solid var(--border)', borderRadius: 5,
        outline: 'none', cursor: 'pointer',
        appearance: 'none',
      }}
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )

  const toggle = (val: boolean, onChange: (v: boolean) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', height: 32, cursor: 'pointer' }}>
      <div style={{ position: 'relative', width: 34, height: 18 }}>
        <input type="checkbox" checked={val} onChange={e => onChange(e.target.checked)}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 9,
          border: `1px solid ${val ? 'var(--border-mid)' : 'var(--border)'}`,
          background: val ? 'var(--text)' : 'transparent',
          transition: 'all .15s',
        }}/>
        <div style={{
          position: 'absolute', top: 3, left: val ? 17 : 3,
          width: 10, height: 10, borderRadius: '50%',
          background: val ? 'var(--bg)' : 'var(--border-mid)',
          transition: 'left .15s',
        }}/>
      </div>
    </label>
  )

  const sep = (label: string) => (
    <div style={{
      fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em',
      color: 'var(--text-3)', paddingTop: 8, borderTop: '1px solid var(--border)',
    }}>
      {label}
    </div>
  )

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(3px)' }}
    >
      <div
        className="in-up"
        onClick={e => e.stopPropagation()}
        style={{
          width: 480, maxHeight: '80vh',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Workspace Config</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1, fontFamily: 'var(--font-geist-mono)' }}>
              .mini-claude/settings.local.json
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4, borderRadius: 4 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sep('Model')}
          {row('Model', input(draft.api?.model || '', v => ua({ model: v }), 'claude-sonnet-4-20250514'))}
          {row('Fallback', input(draft.fallbackModel || '', v => u({ fallbackModel: v }), 'gpt-4o (optional)'))}
          {row('Provider', select(draft.api?.provider || '', v => ua({ provider: v }), [
            ['', 'auto-detect'],
            ['anthropic', 'anthropic'],
            ['openai', 'openai-compatible'],
          ]))}

          {sep('Permissions')}
          {row('Mode', select(draft.permissionMode || 'default', v => u({ permissionMode: v as WorkspaceConfig['permissionMode'] }), [
            ['default', 'default — ask for risky ops'],
            ['auto', 'auto — allow reads'],
            ['plan', 'plan — read-only'],
            ['bypass', 'bypass — allow all'],
          ]))}

          {sep('Developer')}
          {row('Dev Trace', toggle(draft.devTrace || false, v => u({ devTrace: v })), 'record session to .trace.jsonl')}

          {sep('API Endpoints')}
          {row('Anthropic URL', input(draft.api?.anthropicBaseUrl || '', v => ua({ anthropicBaseUrl: v }), 'https://api.anthropic.com'), 'proxy / compatible')}
          {row('OpenAI URL', input(draft.api?.openaiBaseUrl || '', v => ua({ openaiBaseUrl: v }), 'https://api.openai.com/v1'))}

          {sep('API Keys')}
          {row('Anthropic Key',
            input((draft.api as Record<string, unknown>)?.anthropicApiKey as string || '', v => ua({ anthropicApiKey: v } as Record<string, unknown>),
              cfg.api?.hasAnthropicKey ? '(already set)' : 'sk-ant-…', 'password'),
            cfg.api?.hasAnthropicKey ? '● already set' : 'not set'
          )}
          {row('OpenAI Key',
            input((draft.api as Record<string, unknown>)?.openaiApiKey as string || '', v => ua({ openaiApiKey: v } as Record<string, unknown>),
              cfg.api?.hasOpenaiKey ? '(already set)' : 'sk-…', 'password'),
            cfg.api?.hasOpenaiKey ? '● already set' : 'not set'
          )}
        </div>

        {/* footer */}
        <div style={{ padding: '11px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={save}
            disabled={!dirty || saving}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 500,
              border: `1px solid ${dirty ? 'var(--border-mid)' : 'var(--border)'}`,
              borderRadius: 5,
              background: dirty ? 'var(--text)' : 'transparent',
              color: dirty ? 'var(--bg)' : 'var(--text-3)',
              cursor: dirty ? 'pointer' : 'default',
              transition: 'all .15s',
            }}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
          {dirty && (
            <button
              onClick={() => setDraft(cfg)}
              style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }}
            >
              Reset
            </button>
          )}
          <span style={{ flex: 1 }}/>
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>workspace scope</span>
        </div>
      </div>
    </div>
  )
}
