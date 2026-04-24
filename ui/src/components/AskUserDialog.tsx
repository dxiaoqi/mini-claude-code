'use client'

import { useState } from 'react'
import { respondAskUser } from '@/lib/api'

export default function AskUserDialog({
  sessionId,
  requestId,
  question,
  options,
  onDone,
}: {
  sessionId: string
  requestId: string
  question: string
  options: Array<{ id: string; label: string }>
  onDone: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(answer: string) {
    setBusy(true)
    try {
      await respondAskUser(sessionId, requestId, answer)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 55,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,.35)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="a-up"
        style={{
          width: 420,
          maxWidth: '92vw',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div
          style={{
            fontSize: 9,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: 'var(--text-3)',
            marginBottom: 10,
            fontWeight: 600,
          }}
        >
          Agent 提问 (Workflow / HIL)
        </div>
        <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 14px', lineHeight: 1.55 }}>{question}</p>
        {options.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {options.map(o => (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                onClick={() => void submit(o.label)}
                className="btn"
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <textarea
              className="input-base"
              rows={3}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="输入回复…"
              style={{ width: '100%', resize: 'vertical', marginBottom: 12 }}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || !text.trim()}
              onClick={() => void submit(text.trim())}
            >
              发送
            </button>
          </>
        )}
      </div>
    </div>
  )
}
