'use client'

import { useRef, KeyboardEvent } from 'react'

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
    if (ref.current) ref.current.value = ''
    autoResize()
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function autoResize() {
    if (!ref.current) return
    ref.current.style.height = 'auto'
    ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + 'px'
  }

  return (
    <div className="flex items-end gap-3 bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 focus-within:border-zinc-500 transition-colors">
      <textarea
        ref={ref}
        rows={1}
        disabled={disabled}
        placeholder={placeholder || 'Message mini-claude… (Shift+Enter for newline)'}
        onKeyDown={onKey}
        onInput={autoResize}
        className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-500 text-sm resize-none outline-none min-h-[24px] max-h-[200px] disabled:opacity-50"
      />
      <button
        onClick={send}
        disabled={disabled}
        className="w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center shrink-0 transition-colors"
        title="Send (Enter)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M22 2L11 13M22 2L15 22 11 13 2 9l20-7z" />
        </svg>
      </button>
    </div>
  )
}
