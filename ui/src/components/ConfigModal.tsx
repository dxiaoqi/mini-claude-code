'use client'

import { useState, useEffect } from 'react'
import { getConfig, updateConfig, type WorkspaceConfig } from '@/lib/api'

export default function ConfigModal({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg]     = useState<WorkspaceConfig>({})
  const [draft, setDraft] = useState<WorkspaceConfig>({})
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  useEffect(() => { getConfig().then(c => { setCfg(c); setDraft(c) }) }, [])

  const u  = (p: Partial<WorkspaceConfig>) => setDraft(d => ({ ...d, ...p }))
  const ua = (p: Partial<WorkspaceConfig['api']>) => setDraft(d => ({ ...d, api: { ...d.api, ...p } }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg)

  async function save() {
    setSaving(true)
    await updateConfig(draft)
    setCfg(draft); setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inputStyle = {
    width: '100%', padding: '6px 9px',
    fontSize: 12, fontFamily: 'var(--font-geist-mono)',
    background: 'var(--bg)', color: 'var(--text)',
    border: '1px solid var(--border)', borderRadius: 4,
    outline: 'none', transition: 'border-color .12s',
  }

  const labelStyle = {
    fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' as const,
    color: 'var(--text-3)', marginBottom: 4, fontWeight: 600 as const,
    display: 'block',
  }

  const field = (label: string, children: React.ReactNode) => (
    <div>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  )

  const sep = (label: string) => (
    <div style={{ ...labelStyle, paddingTop: 10, borderTop: '1px solid var(--border)', margin: 0 }}>
      {label}
    </div>
  )

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.3)', backdropFilter: 'blur(4px)',
    }}>
      <div className="a-up" onClick={e => e.stopPropagation()} style={{
        width: 440, maxHeight: '82vh',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div className="serif" style={{ fontSize: 15, fontStyle: 'italic', color: 'var(--text)' }}>
              Config
            </div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: 'var(--text-3)', marginTop: 1 }}>
              .blino/settings.local.json
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sep('Model')}
          {field('Model name', (
            <input style={inputStyle} type="text"
              value={draft.api?.model || ''} onChange={e => ua({ model: e.target.value })}
              placeholder="claude-sonnet-4-20250514"
              onFocus={e => (e.target.style.borderColor = 'var(--border-2)')}
              onBlur={e  => (e.target.style.borderColor = 'var(--border)')}
            />
          ))}
          {field('Fallback model', (
            <input style={inputStyle} type="text"
              value={draft.fallbackModel || ''} onChange={e => u({ fallbackModel: e.target.value })}
              placeholder="optional"
              onFocus={e => (e.target.style.borderColor = 'var(--border-2)')}
              onBlur={e  => (e.target.style.borderColor = 'var(--border)')}
            />
          ))}
          {field('Provider', (
            <select style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
              value={draft.api?.provider || ''} onChange={e => ua({ provider: e.target.value })}
            >
              <option value="">auto-detect</option>
              <option value="anthropic">anthropic</option>
              <option value="openai">openai-compatible</option>
            </select>
          ))}

          {sep('Permissions')}
          {field('Mode', (
            <select style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
              value={draft.permissionMode || 'default'}
              onChange={e => u({ permissionMode: e.target.value as WorkspaceConfig['permissionMode'] })}
            >
              <option value="default">default — ask for risky ops</option>
              <option value="auto">auto — allow reads</option>
              <option value="plan">plan — read-only</option>
              <option value="bypass">bypass — allow all</option>
            </select>
          ))}

          {sep('Developer')}
          {field('Dev trace', (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingTop: 2 }}>
              <div style={{ position: 'relative', width: 32, height: 18 }}>
                <input type="checkbox" checked={draft.devTrace || false}
                  onChange={e => u({ devTrace: e.target.checked })}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 9,
                  border: '1px solid var(--border-2)',
                  background: draft.devTrace ? 'var(--ink)' : 'transparent',
                  transition: 'all .15s',
                }}/>
                <div style={{
                  position: 'absolute', top: 3, left: draft.devTrace ? 16 : 3,
                  width: 10, height: 10, borderRadius: '50%',
                  background: draft.devTrace ? 'var(--paper)' : 'var(--border-2)',
                  transition: 'left .15s',
                }}/>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
                record to .trace.jsonl
              </span>
            </label>
          ))}

          {sep('API Endpoints')}
          {field('Anthropic base URL', (
            <input style={inputStyle} type="url"
              value={draft.api?.anthropicBaseUrl || ''} onChange={e => ua({ anthropicBaseUrl: e.target.value })}
              placeholder="https://api.anthropic.com"
              onFocus={e => (e.target.style.borderColor = 'var(--border-2)')}
              onBlur={e  => (e.target.style.borderColor = 'var(--border)')}
            />
          ))}
          {field('OpenAI base URL', (
            <input style={inputStyle} type="url"
              value={draft.api?.openaiBaseUrl || ''} onChange={e => ua({ openaiBaseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              onFocus={e => (e.target.style.borderColor = 'var(--border-2)')}
              onBlur={e  => (e.target.style.borderColor = 'var(--border)')}
            />
          ))}
        </div>

        {/* footer */}
        <div style={{
          padding: '10px 18px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <button onClick={save} disabled={!dirty || saving} style={{
            padding: '6px 16px', fontSize: 12, fontWeight: 600, letterSpacing: '.02em',
            border: '1px solid var(--ink)',
            borderRadius: 4,
            background: dirty ? 'var(--ink)' : 'transparent',
            color: dirty ? 'var(--paper)' : 'var(--text-3)',
            cursor: dirty ? 'pointer' : 'default',
            transition: 'all .15s',
          }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
          {dirty && (
            <button onClick={() => setDraft(cfg)} style={{
              background: 'none', border: 'none', fontSize: 11,
              color: 'var(--text-3)', cursor: 'pointer',
            }}>
              Reset
            </button>
          )}
          <span style={{ flex: 1 }}/>
          <span style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600 }}>
            workspace scope
          </span>
        </div>
      </div>
    </div>
  )
}
