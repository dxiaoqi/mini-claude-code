'use client'

import { useRef, type KeyboardEvent } from 'react'

interface Props {
  onSend: (message: string) => void
  disabled?: boolean
  placeholder?: string
}

export default function ChatInput({ onSend, disabled, placeholder }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  function send() {
    const text = ref.current?.value.trim()
    if (!text || disabled) return
    onSend(text)
    if (ref.current) { ref.current.value = ''; autoResize() }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function autoResize() {
    if (!ref.current) return
    ref.current.style.height = 'auto'
    ref.current.style.height = Math.min(ref.current.scrollHeight, 180) + 'px'
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 8,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '10px 10px 10px 14px',
        transition: 'border-color 0.13s, box-shadow 0.13s',
        boxShadow: 'var(--shadow-sm)',
      }}
      onFocus={() => {}}
      // Handled by CSS :focus-within
    >
      <style>{`
        .chat-wrap:focus-within {
          border-color: var(--border-focus) !important;
          box-shadow: 0 0 0 3px rgba(128,128,128,0.07), var(--shadow-sm) !important;
        }
      `}</style>
      <textarea
        ref={ref}
        rows={1}
        disabled={disabled}
        placeholder={placeholder || 'Message mini-claude… (Enter to send, Shift+Enter for newline)'}
        onKeyDown={onKey}
        onInput={autoResize}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--text)',
          minHeight: 22,
          maxHeight: 180,
          fontFamily: 'inherit',
        }}
        className="placeholder-[var(--text-placeholder)]"
      />

      {/* Send button */}
      <button
        onClick={send}
        disabled={disabled}
        title="Send (Enter)"
        style={{
          width: 30,
          height: 30,
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.13s',
        }}
        onMouseEnter={e => {
          if (!disabled) {
            (e.target as HTMLElement).closest('button')!.style.borderColor = 'var(--border-focus)'
            ;(e.target as HTMLElement).closest('button')!.style.color = 'var(--text)'
          }
        }}
        onMouseLeave={e => {
          ;(e.target as HTMLElement).closest('button')!.style.borderColor = 'var(--border)'
          ;(e.target as HTMLElement).closest('button')!.style.color = 'var(--text-secondary)'
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  )
}
