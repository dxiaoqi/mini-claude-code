'use client'

import { useRef, type KeyboardEvent } from 'react'

export default function ChatInput({
  onSend, disabled, placeholder,
}: {
  onSend: (msg: string) => void; disabled?: boolean; placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  function send() {
    const t = ref.current?.value.trim()
    if (!t || disabled) return
    onSend(t)
    if (ref.current) { ref.current.value = ''; resize() }
  }

  function resize() {
    if (!ref.current) return
    ref.current.style.height = 'auto'
    ref.current.style.height = Math.min(ref.current.scrollHeight, 180) + 'px'
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 8,
      padding: '9px 10px 9px 13px',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, boxShadow: 'var(--shadow)',
      transition: 'border-color .12s',
    }}
    onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--border-mid)')}
    onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <textarea
        ref={ref} rows={1} disabled={disabled}
        placeholder={placeholder || 'Message mini-claude…'}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        onInput={resize}
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          resize: 'none', fontSize: 14, lineHeight: 1.6,
          color: 'var(--text)', minHeight: 22, maxHeight: 180,
          fontFamily: 'inherit',
        }}
      />
      <button onClick={send} disabled={disabled} style={{
        width: 28, height: 28, borderRadius: 5,
        border: '1px solid var(--border)', background: 'transparent',
        color: 'var(--text-2)', cursor: 'pointer', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .12s',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = 'var(--border-mid)'; e.currentTarget.style.color = 'var(--text)' } }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
  )
}
