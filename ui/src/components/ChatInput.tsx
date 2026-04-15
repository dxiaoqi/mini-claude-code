'use client'

import { useRef, type CSSProperties, type KeyboardEvent } from 'react'

const Plus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

const Mic = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
    <line x1="12" y1="18" x2="12" y2="22" />
  </svg>
)

const ArrowUp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="20" x2="12" y2="10" />
    <polyline points="7 15 12 10 17 15" />
  </svg>
)

export default function ChatInput({ onSend, disabled }: { onSend: (msg: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null)

  function send() {
    const t = ref.current?.value.trim()
    if (!t || disabled) return
    onSend(t)
    if (ref.current) {
      ref.current.value = ''
      resize()
    }
  }

  function resize() {
    if (!ref.current) return
    ref.current.style.height = 'auto'
    ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + 'px'
  }

  const iconBtn: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    padding: 0,
    borderRadius: '50%',
    border: '1px solid var(--border-2)',
    background: 'var(--surface)',
    color: 'var(--text-2)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    flexShrink: 0,
    transition: 'border-color .12s, color .12s',
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 10,
        padding: '12px 12px 12px 14px',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-input)',
        boxShadow: 'var(--shadow-sm)',
        transition: 'box-shadow .15s, border-color .15s',
      }}
      onFocusCapture={e => {
        const el = e.currentTarget
        el.style.boxShadow = '0 8px 28px rgba(0,0,0,.07)'
        el.style.borderColor = 'var(--border-2)'
      }}
      onBlurCapture={e => {
        const el = e.currentTarget
        el.style.boxShadow = 'var(--shadow-sm)'
        el.style.borderColor = 'var(--border)'
      }}
    >
      <button
        type="button"
        title="Composer"
        disabled={disabled}
        style={iconBtn}
        onMouseEnter={e => {
          if (!disabled) {
            e.currentTarget.style.borderColor = 'var(--text-2)'
            e.currentTarget.style.color = 'var(--text)'
          }
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--border-2)'
          e.currentTarget.style.color = 'var(--text-2)'
        }}
      >
        <Plus />
      </button>

      <textarea
        ref={ref}
        rows={1}
        disabled={disabled}
        placeholder="Ask a follow up…"
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
        onInput={resize}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--text)',
          minHeight: 22,
          maxHeight: 160,
          fontFamily: 'inherit',
          padding: '6px 4px',
        }}
      />

      <button type="button" title="Voice (placeholder)" disabled style={{ ...iconBtn, opacity: 0.35, cursor: 'default' }}>
        <Mic />
      </button>

      <button
        type="button"
        onClick={send}
        disabled={disabled}
        title="Send"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 38,
          height: 38,
          padding: 0,
          borderRadius: '50%',
          border: '1px solid var(--ink)',
          background: 'var(--ink)',
          color: 'var(--paper)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.35 : 1,
          flexShrink: 0,
          transition: 'opacity .12s, transform .12s',
        }}
        onMouseEnter={e => {
          if (!disabled) e.currentTarget.style.opacity = '0.88'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.opacity = disabled ? '0.35' : '1'
        }}
      >
        <ArrowUp />
      </button>
    </div>
  )
}
