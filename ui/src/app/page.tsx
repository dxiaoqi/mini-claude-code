'use client'

import { useState, useEffect, useRef } from 'react'
import { createSession, streamChatFetch, getSessions, compactSession } from '@/lib/api'
import type { SessionInfo } from '@/lib/api'
import type { ChatMessage, PermissionRequest, ToolCall } from '@/lib/types'
import MessageItem from '@/components/MessageItem'
import ChatInput from '@/components/ChatInput'
import PermissionDialog from '@/components/PermissionDialog'
import ConfigModal from '@/components/ConfigModal'
import TaskTree from '@/components/TaskTree'
import { useTheme } from '@/context/ThemeContext'
import { v4 as uuid } from 'uuid'

/* ── pixel-style mark ────────────────────────────────────── */
function PixelGlyph() {
  const on = 'var(--text)'
  return (
    <svg width="20" height="20" viewBox="0 0 8 8" style={{ imageRendering: 'pixelated' }} aria-hidden>
      <rect x="1" y="1" width="2" height="2" fill={on} opacity={0.9} />
      <rect x="5" y="1" width="2" height="2" fill={on} opacity={0.9} />
      <rect x="1" y="5" width="2" height="2" fill={on} opacity={0.9} />
      <rect x="5" y="5" width="2" height="2" fill={on} opacity={0.9} />
      <rect x="3" y="3" width="2" height="2" fill={on} />
    </svg>
  )
}

const Sun = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="2" x2="12" y2="4" />
    <line x1="12" y1="20" x2="12" y2="22" />
    <line x1="4.2" y1="4.2" x2="5.6" y2="5.6" />
    <line x1="18.4" y1="18.4" x2="19.8" y2="19.8" />
    <line x1="2" y1="12" x2="4" y2="12" />
    <line x1="20" y1="12" x2="22" y2="12" />
    <line x1="4.2" y1="19.8" x2="5.6" y2="18.4" />
    <line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />
  </svg>
)
const Moon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)
const Gear = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)
const Clock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6l4 2" />
  </svg>
)
const Help = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V15" />
    <line x1="12" y1="17" x2="12" y2="17.01" />
  </svg>
)
function TextLink({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: '4px 2px',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-2)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-2)')}
    >
      {children}
    </button>
  )
}

function IconCluster({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: '3px 4px',
        border: '1px solid var(--border-2)',
        borderRadius: 8,
        background: 'var(--surface)',
      }}
    >
      {children}
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        border: 'none',
        borderRadius: 6,
        background: 'transparent',
        color: 'var(--text-2)',
        cursor: 'pointer',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--surface-2)'
        e.currentTarget.style.color = 'var(--text)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--text-2)'
      }}
    >
      {children}
    </button>
  )
}

function MiniBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 8px',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        border: '1px solid var(--border-2)',
        borderRadius: 6,
        background: 'var(--surface)',
        color: 'var(--text-2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        fontFamily: 'inherit',
      }}
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
      {children}
    </button>
  )
}

/* ── session popover ───────────────────────────────────── */
function SessionPopover({
  sessions,
  current,
  onResume,
  onClose,
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
        className="a-fade"
        style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          zIndex: 40,
          width: 260,
          background: 'var(--bg)',
          border: '1px solid var(--border-2)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        <div className="label" style={{ padding: '10px 12px 6px', borderBottom: '1px solid var(--border)' }}>
          Sessions
        </div>
        {sessions.length === 0 ? (
          <div style={{ padding: '12px 12px', fontSize: 12, color: 'var(--text-2)' }}>No history yet</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 280, overflowY: 'auto' }}>
            {sessions.map(s => (
              <li key={s.sessionId}>
                <button
                  onClick={() => {
                    onResume(s.sessionId)
                    onClose()
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    background: s.sessionId === current ? 'var(--surface-2)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e =>
                    (e.currentTarget.style.background = s.sessionId === current ? 'var(--surface-2)' : 'none')
                  }
                >
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: 'var(--text)' }}>
                    [{s.sessionId.slice(0, 8)}]
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>
                    {new Date(s.modifiedAt).toLocaleDateString()}{' '}
                    {new Date(s.modifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

const PROMPTS = [
  { label: 'Read package.json', cmd: 'read package.json' },
  { label: 'Git status', cmd: 'git status' },
  { label: 'List src/ files', cmd: 'list all files under src/' },
  { label: '创建 hello.ts', cmd: '帮我创建一个 hello.ts 文件' },
]

export default function Page() {
  const { theme, toggle } = useTheme()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [permReq, setPermReq] = useState<PermissionRequest | null>(null)
  const [history, setHistory] = useState<{ sessionId: string; modifiedAt: string }[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    createSession().then(i => {
      setSessionId(i.id)
      setSessionInfo(i)
    })
    getSessions().then(d => setHistory(d.history || []))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function scrollToQuick() {
    document.getElementById('quick-prompts')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function scrollToUserMessage(id: string) {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  function addMsg(m: ChatMessage) {
    setMessages(p => [...p, m])
  }

  function patchLast(fn: (m: ChatMessage) => ChatMessage) {
    setMessages(p => {
      const a = [...p]
      for (let i = a.length - 1; i >= 0; i--) {
        if (a[i].role === 'assistant') {
          a[i] = fn(a[i])
          break
        }
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
          setPermReq({
            requestId: ev.requestId,
            toolName: ev.toolName,
            input: ev.input,
            message: ev.message,
            riskLevel: ev.riskLevel,
          })
        } else if (ev.type === 'error') {
          patchLast(m => ({ ...m, text: m.text + (m.text ? '\n\n' : '') + `// error: ${ev.message || 'unknown'}` }))
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patchLast(m => ({ ...m, text: m.text + '\n\n// connection error' }))
    } finally {
      patchLast(m => ({ ...m, isStreaming: false }))
      setStreaming(false)
      abortRef.current = null
      if (sessionId) createSession({ sessionId }).then(setSessionInfo)
    }
  }

  async function newSession() {
    const i = await createSession()
    setSessionId(i.id)
    setSessionInfo(i)
    setMessages([])
    getSessions().then(d => setHistory(d.history || []))
  }

  async function resumeSession(sid: string) {
    const i = await createSession({ resumeSessionId: sid })
    setSessionId(i.id)
    setSessionInfo(i)
    setMessages([{ id: uuid(), role: 'system', text: `// resumed [${sid.slice(0, 8)}]`, toolCalls: [], timestamp: Date.now() }])
    getSessions().then(d => setHistory(d.history || []))
  }

  async function compact() {
    if (!sessionId) return
    const r = await compactSession(sessionId)
    if (r.ok)
      addMsg({
        id: uuid(),
        role: 'system',
        text: `// compact ${r.preTokens?.toLocaleString()} → ${r.postTokens?.toLocaleString()} tokens`,
        toolCalls: [],
        timestamp: Date.now(),
      })
  }

  const tokens = sessionInfo ? sessionInfo.totalInputTokens + sessionInfo.totalOutputTokens : 0
  const dividerLabel =
    messages.length === 0 ? 'Task initiated' : streaming ? 'Running' : 'In progress'

  return (
    <div className="app-shell">
      <div className="chat-card">
        {/* header — reference: CHAT + quick + icon cluster */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 18px 12px',
            flexShrink: 0,
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PixelGlyph />
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--text)',
              }}
            >
              Chat
            </span>
            {sessionId && (
              <span style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: 'var(--text-3)' }}>
                [{sessionId.slice(0, 8)}]
              </span>
            )}
          </div>

          {streaming && (
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  style={{
                    width: 3.5,
                    height: 3.5,
                    borderRadius: '50%',
                    background: 'var(--text-2)',
                    display: 'inline-block',
                    animation: `dot 1.1s ease-in-out ${i * 0.18}s infinite`,
                  }}
                />
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {tokens > 0 && (
              <span className="label" style={{ marginRight: 4 }}>
                {tokens.toLocaleString()} tok
                {sessionInfo?.totalCostUSD && sessionInfo.totalCostUSD > 0.0001
                  ? ` · $${sessionInfo.totalCostUSD.toFixed(3)}`
                  : ''}
              </span>
            )}
            <TextLink onClick={scrollToQuick}>Quick start</TextLink>
            {streaming ? (
              <MiniBtn onClick={() => abortRef.current?.abort()}>Stop</MiniBtn>
            ) : (
              <MiniBtn onClick={compact}>Compact</MiniBtn>
            )}
            <MiniBtn onClick={newSession}>New</MiniBtn>
            <IconCluster>
              <IconBtn title="Shortcuts / quick prompts" onClick={scrollToQuick}>
                <Help />
              </IconBtn>
              <div style={{ position: 'relative' }}>
                <IconBtn
                  title="History"
                  onClick={() => {
                    setShowHistory(v => !v)
                    getSessions().then(d => setHistory(d.history || []))
                  }}
                >
                  <Clock />
                </IconBtn>
                {showHistory && (
                  <SessionPopover
                    sessions={history}
                    current={sessionId}
                    onResume={resumeSession}
                    onClose={() => setShowHistory(false)}
                  />
                )}
              </div>
              <IconBtn title="Workspace settings" onClick={() => setShowConfig(true)}>
                <Gear />
              </IconBtn>
              <IconBtn title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggle}>
                {theme === 'dark' ? <Sun /> : <Moon />}
              </IconBtn>
            </IconCluster>
          </div>
        </header>

        {/* divider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '10px 18px',
            flexShrink: 0,
            background: 'var(--bg)',
          }}
        >
          <div style={{ flex: 1, height: 1, background: 'var(--border-2)' }} />
          <span className="label" style={{ flexShrink: 0 }}>
            {dividerLabel}
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--border-2)' }} />
        </div>

        {/* main: tree + stream */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            minHeight: 0,
            borderTop: '1px solid var(--border)',
          }}
        >
          <aside
            style={{
              width: 240,
              flexShrink: 0,
              minHeight: 0,
              borderRight: '1px solid var(--border)',
              padding: '16px 14px 16px 18px',
              background: 'var(--surface)',
              overflowY: 'auto',
            }}
          >
            <TaskTree messages={messages} onSelectUserMessage={scrollToUserMessage} />
          </aside>

          <main
            className="chat-card-inner-grid"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '16px 20px 20px',
              minWidth: 0,
              background: 'var(--bg)',
            }}
          >
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              {messages.length === 0 && (
                <div className="a-up" style={{ paddingBottom: 28 }}>
                  <div className="label" style={{ marginBottom: 12 }}>
                    Start here
                  </div>
                  <h1
                    style={{
                      fontSize: 28,
                      fontWeight: 600,
                      letterSpacing: '-0.02em',
                      color: 'var(--text)',
                      margin: '0 0 10px',
                      lineHeight: 1.2,
                    }}
                  >
                    mini-claude
                  </h1>
                  <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 28px', lineHeight: 1.6, maxWidth: 400 }}>
                    Files, commands, and edits — wired to your repo. Pick a prompt or type below.
                  </p>
                  <div id="quick-prompts">
                    <div className="label" style={{ marginBottom: 10 }}>
                      Quick prompts
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {PROMPTS.map(p => (
                        <button
                          key={p.cmd}
                          type="button"
                          onClick={() => send(p.cmd)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 14px',
                            textAlign: 'left',
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 10,
                            fontSize: 13,
                            color: 'var(--text)',
                            cursor: 'pointer',
                            transition: 'border-color .12s, box-shadow .12s',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = 'var(--border-2)'
                            e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = 'var(--border)'
                            e.currentTarget.style.boxShadow = 'none'
                          }}
                        >
                          <span>{p.label}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>→</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {messages.map(m => (
                <MessageItem key={m.id} message={m} />
              ))}
              <div ref={bottomRef} />
            </div>
          </main>
        </div>

        <footer
          style={{
            flexShrink: 0,
            padding: '12px 18px 18px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <ChatInput onSend={send} disabled={streaming || !sessionId} />
          </div>
        </footer>
      </div>

      {permReq && <PermissionDialog request={permReq} onResolved={() => setPermReq(null)} />}
      {showConfig && <ConfigModal onClose={() => setShowConfig(false)} />}
    </div>
  )
}
