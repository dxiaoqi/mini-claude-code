'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { SkillCreatorInstallOrView } from '@/components/SkillCreatorInstallOrView'

export interface ApiConfigResponse {
  model: string
  fallbackModel?: string
  api?: {
    provider?: string
    model?: string
    anthropicBaseUrl?: string
    openaiBaseUrl?: string
    hasAnthropicKey?: boolean
    hasOpenaiKey?: boolean
  }
}

interface Props {
  blinoUrl: string
  open: boolean
  onClose: () => void
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: '13px',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  color: 'var(--text-primary)',
  background: 'var(--bg-secondary)',
  border: '0.5px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.03em',
  color: 'var(--text-tertiary)',
  marginBottom: 6,
  textTransform: 'uppercase',
}

export function ApiSettingsPanel({ blinoUrl, open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('openai')
  const [model, setModel] = useState('')
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState('')
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false)
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const r = await fetch(`${blinoUrl}/api/config`)
      if (!r.ok) throw new Error('加载配置失败')
      const d = await r.json() as ApiConfigResponse
      const api = d.api || {}
      const p = api.provider === 'anthropic' ? 'anthropic' : 'openai'
      setProvider(p)
      setModel(api.model || d.model || '')
      setAnthropicBaseUrl(api.anthropicBaseUrl || '')
      setOpenaiBaseUrl(api.openaiBaseUrl || '')
      setHasAnthropicKey(!!api.hasAnthropicKey)
      setHasOpenaiKey(!!api.hasOpenaiKey)
      setAnthropicKey('')
      setOpenaiKey('')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [blinoUrl])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const api: Record<string, unknown> = {
        provider,
        model: model.trim(),
      }
      const ab = anthropicBaseUrl.trim()
      const ob = openaiBaseUrl.trim()
      if (ab) api.anthropicBaseUrl = ab
      if (ob) api.openaiBaseUrl = ob
      if (anthropicKey.trim()) api.anthropicApiKey = anthropicKey.trim()
      if (openaiKey.trim()) api.openaiApiKey = openaiKey.trim()

      const r = await fetch(`${blinoUrl}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api }),
      })
      const body = await r.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!r.ok || body.ok === false) {
        throw new Error(body.error || '保存失败')
      }
      await load()
      setMessage('已写入 .blino/settings.local.json，Agent 将使用新密钥。')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-labelledby="settings-panel-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(0,0,0,0.35)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <aside
        style={{
          width: 'min(400px, 100vw)',
          height: '100%',
          background: 'var(--bg-primary)',
          borderLeft: '0.5px solid var(--border-default)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'apiPanelIn 0.2s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        <style>{`
          @keyframes apiPanelIn {
            from { transform: translateX(100%); opacity: 0.6; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>

        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 18px',
            borderBottom: '0.5px solid var(--border-default)',
          }}
        >
          <h2 id="settings-panel-title" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
            设置
          </h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              padding: 0,
              border: 'none',
              borderRadius: 'var(--radius-md)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <X width={18} height={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px' }}>
          {loading ? (
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>加载中…</p>
          ) : (
            <>
              <div style={{ marginBottom: 18 }}>
                <span style={labelStyle}>提供商</span>
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value as 'anthropic' | 'openai')}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="openai">OpenAI 兼容</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>

              <div style={{ marginBottom: 18 }}>
                <span style={labelStyle}>模型 ID</span>
                <input
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder={provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'}
                  style={inputStyle}
                  autoComplete="off"
                />
              </div>

              {provider === 'anthropic' ? (
                <div style={{ marginBottom: 18 }}>
                  <span style={labelStyle}>Anthropic Base URL</span>
                  <input
                    value={anthropicBaseUrl}
                    onChange={e => setAnthropicBaseUrl(e.target.value)}
                    placeholder="https://api.anthropic.com"
                    style={inputStyle}
                    autoComplete="off"
                  />
                </div>
              ) : (
                <div style={{ marginBottom: 18 }}>
                  <span style={labelStyle}>OpenAI Base URL</span>
                  <input
                    value={openaiBaseUrl}
                    onChange={e => setOpenaiBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    style={inputStyle}
                    autoComplete="off"
                  />
                  <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>
                    兼容接口必填；留空则依赖环境变量 OPENAI_BASE_URL。
                  </p>
                </div>
              )}

              <div style={{ marginBottom: 18 }}>
                <span style={labelStyle}>
                  {provider === 'anthropic' ? 'Anthropic API Key' : 'API Key'}
                </span>
                <input
                  type="password"
                  value={provider === 'anthropic' ? anthropicKey : openaiKey}
                  onChange={e => provider === 'anthropic' ? setAnthropicKey(e.target.value) : setOpenaiKey(e.target.value)}
                  placeholder={
                    (provider === 'anthropic' ? hasAnthropicKey : hasOpenaiKey)
                      ? '已保存 · 留空表示不修改'
                      : '粘贴密钥'
                  }
                  style={inputStyle}
                  autoComplete="off"
                />
              </div>

              <div style={{ marginBottom: 18, paddingTop: 6, borderTop: '0.5px solid var(--border-default)' }}>
                <span style={labelStyle}>工作流 / Skill</span>
                <p style={{ margin: '0 0 10px', fontSize: '12px', lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
                  将内置的 <code style={{ fontSize: '11px' }}>skill-creator</code> 写入项目{' '}
                  <code style={{ fontSize: '11px' }}>.blino/skills/</code>，用于脚手架 workflow 与各阶段 skill 包。
                </p>
                <SkillCreatorInstallOrView
                  blinoUrl={blinoUrl}
                  panelOpen={open}
                  onMessage={setMessage}
                />
              </div>

              {message && (
                <p style={{
                  margin: '0 0 16px',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  color: message.startsWith('已') ? 'var(--accent)' : 'var(--text-secondary)',
                }}>
                  {message}
                </p>
              )}
            </>
          )}
        </div>

        <div
          style={{
            flexShrink: 0,
            padding: '14px 18px',
            borderTop: '0.5px solid var(--border-default)',
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              background: 'var(--bg-secondary)',
              border: '0.5px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void save()}
            style={{
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 600,
              color: 'white',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: saving || loading ? 'not-allowed' : 'pointer',
              opacity: saving || loading ? 0.65 : 1,
            }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </aside>
    </div>
  )
}
