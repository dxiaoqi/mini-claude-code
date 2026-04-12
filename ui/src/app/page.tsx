'use client'

import { useState, useEffect, useRef } from 'react'
import { createSession, streamChatFetch, getSessions, compactSession } from '@/lib/api'
import type { SessionInfo } from '@/lib/api'
import type { ChatMessage, PermissionRequest, ToolCall } from '@/lib/types'
import MessageItem from '@/components/MessageItem'
import ChatInput from '@/components/ChatInput'
import PermissionDialog from '@/components/PermissionDialog'
import ConfigModal from '@/components/ConfigModal'
import { useTheme } from '@/context/ThemeContext'
import { v4 as uuid } from 'uuid'

/* ── tiny icons ──────────────────────────────────────────── */
const Sun = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/>
    <line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/>
    <line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/>
    <line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>
  </svg>
)
const Moon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)
const Gear = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)
const Plus = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)
const History = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <polyline points="1 4 1 10 7 10"/>
    <path d="M3.51 15a9 9 0 1 0 .49-3"/>
  </svg>
)

/* ── small btn ───────────────────────────────────────────── */
function Btn({
  children, onClick, disabled, active, title,
}: {
  children: React.ReactNode; onClick?: () => void
  disabled?: boolean; active?: boolean; title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 9px',
        fontSize: 12, fontWeight: 500,
        border: `1px solid ${active ? 'var(--border-mid)' : 'var(--border)'}`,
        borderRadius: 5,
        background: active ? 'var(--border)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-2)',
        cursor: 'pointer',
        transition: 'all .12s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        if (!disabled) {
          const el = e.currentTarget
          el.style.borderColor = 'var(--border-mid)'
          el.style.color = 'var(--text)'
        }
      }}
      onMouseLeave={e => {
        const el = e.currentTarget
        el.style.borderColor = active ? 'var(--border-mid)' : 'var(--border)'
        el.style.color = active ? 'var(--text)' : 'var(--text-2)'
      }}
    >
      {children}
    </button>
  )
}

/* ── history popover ─────────────────────────────────────── */
function HistoryPopover({
  sessions, current, onResume, onClose,
}: {
  sessions: { sessionId: string; modifiedAt: string }[]
  current: string | null
  onResume: (id: string) => void
  onClose: () => void
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
      <div
        className="in-up"
        style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          zIndex: 40, width: 260,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>Recent sessions</span>
        </div>
        {sessions.length === 0 ? (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>No history</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 260, overflowY: 'auto' }}>
            {sessions.map(s => (
              <li key={s.sessionId}>
                <button
                  onClick={() => { onResume(s.sessionId); onClose() }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 12px',
                    background: s.sessionId === current ? 'var(--border)' : 'none',
                    border: 'none', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                  onMouseLeave={e => (e.currentTarget.style.background = s.sessionId === current ? 'var(--border)' : 'none')}
                >
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: 'var(--text)' }}>
                    {s.sessionId.slice(0, 16)}…
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>
                    {new Date(s.modifiedAt).toLocaleString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/* ── main ────────────────────────────────────────────────── */
const PROMPTS = ['read package.json', 'git status', 'list src/ files', '帮我写 hello.ts']

export default function Page() {
  const { theme, toggle } = useTheme()
  const [sessionId, setSessionId]   = useState<string | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [messages, setMessages]     = useState<ChatMessage[]>([])
  const [streaming, setStreaming]   = useState(false)
  const [permReq, setPermReq]       = useState<PermissionRequest | null>(null)
  const [history, setHistory]       = useState<{ sessionId: string; modifiedAt: string }[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef  = useRef<AbortController | null>(null)

  useEffect(() => {
    createSession().then(i => { setSessionId(i.id); setSessionInfo(i) })
    getSessions().then(d => setHistory(d.history || []))
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  function addMsg(m: ChatMessage) { setMessages(p => [...p, m]) }

  function patchLast(fn: (m: ChatMessage) => ChatMessage) {
    setMessages(p => {
      const a = [...p]
      for (let i = a.length - 1; i >= 0; i--) {
        if (a[i].role === 'assistant') { a[i] = fn(a[i]); break }
      }
      return a
    })
  }

  async function send(text: string) {
    if (!sessionId || streaming) return
    addMsg({ id: uuid(), role: 'user', text, toolCalls: [], timestamp: Date.now() })
    addMsg({ id: uuid(), role: 'assistant', text: '', toolCalls: [], isStreaming: true, timestamp: Date.now() })
    setStreaming(true)
    abortRef.current = new AbortController()

    try {
      for await (const ev of streamChatFetch(sessionId, text, {}, abortRef.current.signal)) {
        if (ev.type === 'text_delta') patchLast(m => ({ ...m, text: m.text + ev.text }))
        else if (ev.type === 'tool_use_start') {
          const tc: ToolCall = { id: ev.id, name: ev.name, input: ev.input, status: 'running' }
          patchLast(m => ({ ...m, toolCalls: [...m.toolCalls, tc] }))
        } else if (ev.type === 'tool_result') {
          patchLast(m => ({
            ...m,
            toolCalls: m.toolCalls.map(tc =>
              tc.id === ev.toolUseId ? { ...tc, status: ev.isError ? 'error' : 'done', result: ev.result, isError: ev.isError } : tc
            ),
          }))
        } else if (ev.type === 'turn_complete') {
          patchLast(m => ({ ...m, usage: ev.usage }))
        } else if (ev.type === 'permission_request') {
          setPermReq({ requestId: ev.requestId, toolName: ev.toolName, input: ev.input, message: ev.message, riskLevel: ev.riskLevel })
        } else if (ev.type === 'error') {
          patchLast(m => ({ ...m, text: m.text + (m.text ? '\n\n' : '') + `⚠ ${ev.message || 'Error'}` }))
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patchLast(m => ({ ...m, text: m.text + '\n\n⚠ Connection error' }))
    } finally {
      patchLast(m => ({ ...m, isStreaming: false }))
      setStreaming(false)
      abortRef.current = null
      if (sessionId) createSession({ sessionId }).then(setSessionInfo)
    }
  }

  async function newSession() {
    const i = await createSession()
    setSessionId(i.id); setSessionInfo(i); setMessages([])
    getSessions().then(d => setHistory(d.history || []))
  }

  async function resumeSession(sid: string) {
    const i = await createSession({ resumeSessionId: sid })
    setSessionId(i.id); setSessionInfo(i)
    setMessages([{ id: uuid(), role: 'system', text: `resumed ${sid.slice(0, 8)}…`, toolCalls: [], timestamp: Date.now() }])
    getSessions().then(d => setHistory(d.history || []))
  }

  async function compact() {
    if (!sessionId) return
    const r = await compactSession(sessionId)
    if (r.ok) addMsg({ id: uuid(), role: 'system', text: `compacted — ${r.preTokens?.toLocaleString()} → ${r.postTokens?.toLocaleString()} tokens`, toolCalls: [], timestamp: Date.now() })
  }

  const tokens = sessionInfo ? sessionInfo.totalInputTokens + sessionInfo.totalOutputTokens : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>

      {/* ── header ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', height: 44,
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        flexShrink: 0,
      }}>
        {/* left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--text)' }}>
            mini-claude
          </span>
          {sessionInfo && (
            <span style={{
              fontSize: 11, fontFamily: 'var(--font-geist-mono)',
              color: 'var(--text-3)',
              padding: '1px 6px', border: '1px solid var(--border)',
              borderRadius: 3,
            }}>
              {sessionId?.slice(0, 8)}
            </span>
          )}
        </div>

        {/* center — streaming indicator */}
        {streaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                width: 4, height: 4, borderRadius: '50%',
                background: 'var(--text-2)',
                display: 'inline-block',
                animation: `dot .9s ease-in-out ${i * .15}s infinite`,
              }}/>
            ))}
          </div>
        )}

        {/* right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {sessionInfo && tokens > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-3)', marginRight: 4 }}>
              {tokens.toLocaleString()} tok
              {sessionInfo.totalCostUSD > 0.0001 && ` · $${sessionInfo.totalCostUSD.toFixed(3)}`}
            </span>
          )}
          {streaming ? (
            <Btn onClick={() => abortRef.current?.abort()}>Stop</Btn>
          ) : (
            <Btn onClick={compact} disabled={!sessionId} title="Compact context">/compact</Btn>
          )}
          <div style={{ position: 'relative' }}>
            <Btn onClick={() => { setShowHistory(v => !v); getSessions().then(d => setHistory(d.history || [])) }} active={showHistory}>
              <History />
            </Btn>
            {showHistory && (
              <HistoryPopover
                sessions={history} current={sessionId}
                onResume={resumeSession}
                onClose={() => setShowHistory(false)}
              />
            )}
          </div>
          <Btn onClick={newSession}><Plus /></Btn>
          <Btn onClick={() => setShowConfig(true)} title="Settings"><Gear /></Btn>
          <Btn onClick={toggle} title="Toggle theme">
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Btn>
        </div>
      </header>

      {/* ── messages ── */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 8px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {messages.length === 0 && (
            <div className="in-up" style={{ textAlign: 'center', marginTop: 72 }}>
              <div style={{
                width: 40, height: 40, margin: '0 auto 16px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-2)',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="16 18 22 12 16 6"/>
                  <polyline points="8 6 2 12 8 18"/>
                </svg>
              </div>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>mini-claude-code</p>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>
                Ask me to read files, write code, run commands
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                {PROMPTS.map(p => (
                  <Btn key={p} onClick={() => send(p)}>
                    <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11 }}>{p}</span>
                  </Btn>
                ))}
              </div>
            </div>
          )}

          {messages.map(m => <MessageItem key={m.id} message={m} />)}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* ── input ── */}
      <footer style={{
        flexShrink: 0, padding: '10px 20px 16px',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <ChatInput onSend={send} disabled={streaming || !sessionId} />
          <p style={{
            marginTop: 6, textAlign: 'center',
            fontSize: 10, color: 'var(--text-3)',
            fontFamily: 'var(--font-geist-mono)',
          }}>
            Enter · Shift+Enter newline
          </p>
        </div>
      </footer>

      {permReq && <PermissionDialog request={permReq} onResolved={() => setPermReq(null)} />}
      {showConfig && <ConfigModal onClose={() => setShowConfig(false)} />}
    </div>
  )
}
