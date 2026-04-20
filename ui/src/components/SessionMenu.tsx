'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquarePlus, History } from 'lucide-react'

export interface SessionHistoryItem {
  sessionId: string
  /** ISO string from JSON */
  modifiedAt: string
}

interface Props {
  blinoUrl: string
  disabled?: boolean
  activeSessionId: string | null
  onNewSession: () => void | Promise<void>
  onSwitchSession: (sessionId: string) => void | Promise<void>
}

function formatSessionTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
    return d.toLocaleDateString()
  } catch {
    return ''
  }
}

export function SessionMenu({ blinoUrl, disabled, activeSessionId, onNewSession, onSwitchSession }: Props) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<SessionHistoryItem[]>([])
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshHistory = useCallback(async () => {
    try {
      const r = await fetch(`${blinoUrl}/api/sessions`)
      if (!r.ok) return
      const d = await r.json() as { history?: SessionHistoryItem[] }
      const list = d.history ?? []
      setHistory(
        list.map(h => ({
          sessionId: h.sessionId,
          modifiedAt: typeof h.modifiedAt === 'string' ? h.modifiedAt : new Date(h.modifiedAt as unknown as Date).toISOString(),
        })),
      )
    } catch {
      setHistory([])
    }
  }, [blinoUrl])

  useEffect(() => {
    if (open) void refreshHistory()
  }, [open, refreshHistory])

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 220)
  }

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => {
        cancelClose()
        setOpen(true)
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => void onNewSession()}
        title="开始新会话（悬停查看历史）"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '6px 10px',
          fontSize: '12px',
          fontWeight: 500,
          color: 'var(--text-secondary)',
          background: 'var(--bg-secondary)',
          border: '0.5px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <MessageSquarePlus width={13} height={13} />
        新会话
        <History width={12} height={12} style={{ opacity: 0.65 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 260,
            maxHeight: 280,
            overflowY: 'auto',
            padding: '8px 0',
            background: 'var(--bg-primary)',
            border: '0.5px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 50,
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div
            style={{
              padding: '6px 12px 8px',
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
            }}
          >
            历史会话
          </div>
          {history.length === 0 && (
            <div style={{ padding: '12px 14px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
              暂无已保存会话
            </div>
          )}
          {history.map(h => {
            const active = activeSessionId === h.sessionId
            const shortId = h.sessionId.length > 12 ? `${h.sessionId.slice(0, 8)}…` : h.sessionId
            return (
              <button
                key={h.sessionId}
                type="button"
                disabled={disabled}
                onClick={() => void onSwitchSession(h.sessionId)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 14px',
                  fontSize: '12px',
                  border: 'none',
                  background: active ? 'var(--accent-bg)' : 'transparent',
                  color: 'var(--text-primary)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '11px' }}>{shortId}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {formatSessionTime(h.modifiedAt)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
