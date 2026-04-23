'use client'

import { useState, useEffect, useCallback } from 'react'
import { getConfig, updateConfig, type WorkspaceConfig } from '@/lib/api'

interface Props {
  onClose: () => void
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{label}</label>
        {hint && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--text-muted)',
          paddingBottom: 6,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

export default function ConfigPanel({ onClose }: Props) {
  const [config, setConfig] = useState<WorkspaceConfig>({})
  const [draft, setDraft] = useState<WorkspaceConfig>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showApiKeys, setShowApiKeys] = useState(false)

  useEffect(() => {
    getConfig().then(c => { setConfig(c); setDraft(c) })
  }, [])

  function update(patch: Partial<WorkspaceConfig>) {
    setDraft(d => ({ ...d, ...patch }))
  }

  function updateApi(patch: Partial<WorkspaceConfig['api']>) {
    setDraft(d => ({ ...d, api: { ...d.api, ...patch } }))
  }

  async function save() {
    setSaving(true)
    try {
      await updateConfig(draft)
      setConfig(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(config)

  return (
    <div
      className="slide-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Workspace Config</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            .blino/settings.local.json
          </div>
        </div>
        <button
          onClick={onClose}
          className="btn btn-ghost"
          style={{ padding: '4px 6px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

        <Section title="Model">
          <Field label="Model" hint="active sessions updated immediately">
            <input
              type="text"
              className="input-base mono"
              value={draft.api?.model || ''}
              onChange={e => updateApi({ model: e.target.value })}
              placeholder="claude-sonnet-4-20250514"
            />
          </Field>
          <Field label="Fallback Model" hint="used when primary fails">
            <input
              type="text"
              className="input-base mono"
              value={draft.fallbackModel || ''}
              onChange={e => update({ fallbackModel: e.target.value })}
              placeholder="gpt-4o"
            />
          </Field>
          <Field label="Provider">
            <select
              className="input-base"
              value={draft.api?.provider || ''}
              onChange={e => updateApi({ provider: e.target.value })}
            >
              <option value="">auto-detect</option>
              <option value="anthropic">anthropic</option>
              <option value="openai">openai-compatible</option>
            </select>
          </Field>
        </Section>

        <Section title="Permissions">
          <Field label="Permission Mode" hint="default: ask for writes">
            <select
              className="input-base"
              value={draft.permissionMode || 'default'}
              onChange={e => update({ permissionMode: e.target.value as WorkspaceConfig['permissionMode'] })}
            >
              <option value="default">default — ask for risky operations</option>
              <option value="auto">auto — auto-allow reads</option>
              <option value="plan">plan — read-only, no writes</option>
              <option value="bypass">bypass — auto-approve all</option>
            </select>
          </Field>
        </Section>

        <Section title="Developer">
          <Field label="Dev Trace" hint="record session events to .trace.jsonl">
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.devTrace || false}
                onChange={e => update({ devTrace: e.target.checked })}
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </Field>
        </Section>

        <Section title="API Endpoints">
          <Field label="Anthropic Base URL" hint="for proxy / compatible APIs">
            <input
              type="url"
              className="input-base mono"
              value={draft.api?.anthropicBaseUrl || ''}
              onChange={e => updateApi({ anthropicBaseUrl: e.target.value })}
              placeholder="https://api.anthropic.com"
            />
          </Field>
          <Field label="OpenAI-Compatible Base URL">
            <input
              type="url"
              className="input-base mono"
              value={draft.api?.openaiBaseUrl || ''}
              onChange={e => updateApi({ openaiBaseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </Field>
        </Section>

        {/* API Keys — collapsed by default for security */}
        <Section title="API Keys">
          {!showApiKeys ? (
            <button
              className="btn"
              onClick={() => setShowApiKeys(true)}
              style={{ alignSelf: 'flex-start' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Show API Key fields
            </button>
          ) : (
            <>
              <Field
                label="Anthropic API Key"
                hint={config.api?.hasAnthropicKey ? '● already set' : 'not set'}
              >
                <input
                  type="password"
                  className="input-base mono"
                  value={(draft.api as Record<string, unknown>)?.anthropicApiKey as string || ''}
                  onChange={e => updateApi({ anthropicApiKey: e.target.value } as Record<string, unknown>)}
                  placeholder={config.api?.hasAnthropicKey ? '(keep existing)' : 'sk-ant-…'}
                  autoComplete="off"
                />
              </Field>
              <Field
                label="OpenAI API Key"
                hint={config.api?.hasOpenaiKey ? '● already set' : 'not set'}
              >
                <input
                  type="password"
                  className="input-base mono"
                  value={(draft.api as Record<string, unknown>)?.openaiApiKey as string || ''}
                  onChange={e => updateApi({ openaiApiKey: e.target.value } as Record<string, unknown>)}
                  placeholder={config.api?.hasOpenaiKey ? '(keep existing)' : 'sk-…'}
                  autoComplete="off"
                />
              </Field>
              <button
                className="btn btn-ghost"
                onClick={() => setShowApiKeys(false)}
                style={{ alignSelf: 'flex-start', fontSize: 11 }}
              >
                Hide keys
              </button>
            </>
          )}
        </Section>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <button
          className="btn"
          onClick={save}
          disabled={!isDirty || saving}
          style={isDirty ? { borderColor: 'var(--border-focus)', color: 'var(--text)' } : {}}
        >
          {saving ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : saved ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Saved
            </>
          ) : (
            'Save changes'
          )}
        </button>
        {isDirty && !saving && (
          <button
            className="btn btn-ghost"
            onClick={() => setDraft(config)}
            style={{ fontSize: 11 }}
          >
            Reset
          </button>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          workspace-level
        </span>
      </div>
    </div>
  )
}
