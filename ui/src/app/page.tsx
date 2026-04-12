'use client'

import { useState, useEffect, useRef } from 'react'
import { createSession, streamChatFetch, getSessions, compactSession } from '@/lib/api'
import type { SessionInfo } from '@/lib/api'
import type { ChatMessage, PermissionRequest, ToolCall } from '@/lib/types'
import MessageItem from '@/components/MessageItem'
import ChatInput from '@/components/ChatInput'
import PermissionDialog from '@/components/PermissionDialog'
import ConfigPanel from '@/components/ConfigPanel'
import { useTheme } from '@/context/ThemeContext'
import { v4 as uuid } from 'uuid'

// ── Icons ────────────────────────────────────────────────────────────────────

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarProps {
  sessionId: string | null
  sessionInfo: SessionInfo | null
  recentSessions: { sessionId: string; modifiedAt: string }[]
  onNew: () => void
  onResume: (id: string) => void
  onCompact: () => void
  isStreaming: boolean
  activePanel: 'sessions' | 'config' | null
  onTogglePanel: (p: 'sessions' | 'config') => void
}

function Sidebar({
  sessionId, sessionInfo, recentSessions,
  onNew, onResume, onCompact, isStreaming,
  activePanel, onTogglePanel,
}: SidebarProps) {
  return (
    <aside
      style={{
        width: 220,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          mini-claude
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, fontFamily: 'var(--font-geist-mono)' }}>
          code assistant
        </div>
      </div>

      {/* Session actions */}
      <div style={{ padding: '10px 10px 6px' }}>
        <button className="btn" onClick={onNew} style={{ width: '100%', justifyContent: 'center' }}>
          <PlusIcon /> New session
        </button>
      </div>

      {/* Current session info */}
      {sessionInfo && (
        <div style={{ padding: '4px 12px 8px' }}>
          <div
            style={{
              padding: '7px 9px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-elevated)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Current session</div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: 'var(--text)', marginBottom: 2 }}>
              {sessionInfo.id.slice(0, 12)}…
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
              {(sessionInfo.totalInputTokens + sessionInfo.totalOutputTokens).toLocaleString()} tokens
              {sessionInfo.totalCostUSD > 0.0001 && (
                <> · ${sessionInfo.totalCostUSD.toFixed(4)}</>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <button
                className="btn btn-ghost"
                onClick={onCompact}
                disabled={isStreaming || !sessionId}
                style={{ fontSize: 10, padding: '2px 7px' }}
              >
                /compact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sessions list section */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <button
          onClick={() => onTogglePanel('sessions')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            width: '100%',
            borderTop: '1px solid var(--border)',
          }}
        >
          <span>History</span>
          <ChevronIcon open={activePanel === 'sessions'} />
        </button>

        {activePanel === 'sessions' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {recentSessions.length === 0 ? (
              <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
                No history yet
              </div>
            ) : (
              recentSessions.map(s => (
                <button
                  key={s.sessionId}
                  onClick={() => onResume(s.sessionId)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 12px',
                    background: s.sessionId === sessionId ? 'var(--bg-hover)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = s.sessionId === sessionId ? 'var(--bg-hover)' : 'none')}
                >
                  <div
                    style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: 'var(--text)', marginBottom: 1 }}
                  >
                    {s.sessionId.slice(0, 12)}…
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {new Date(s.modifiedAt).toLocaleDateString()}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Config section toggle at bottom */}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={() => onTogglePanel('config')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            background: activePanel === 'config' ? 'var(--bg-hover)' : 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            fontSize: 11,
            width: '100%',
            transition: 'background 0.1s',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <SettingsIcon /> Config
          </span>
          <ChevronIcon open={activePanel === 'config'} />
        </button>
      </div>
    </aside>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { theme, toggle } = useTheme()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [permRequest, setPermRequest] = useState<PermissionRequest | null>(null)
  const [recentSessions, setRecentSessions] = useState<{ sessionId: string; modifiedAt: string }[]>([])
  const [activePanel, setActivePanel] = useState<'sessions' | 'config' | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    createSession().then(info => { setSessionId(info.id); setSessionInfo(info) })
    getSessions().then(d => setRecentSessions(d.history || []))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function addMessage(msg: ChatMessage) {
    setMessages(prev => [...prev, msg])
  }

  function updateLastAssistant(updater: (msg: ChatMessage) => ChatMessage) {
    setMessages(prev => {
      const last = [...prev]
      for (let i = last.length - 1; i >= 0; i--) {
        if (last[i].role === 'assistant') { last[i] = updater(last[i]); break }
      }
      return last
    })
  }

  async function sendMessage(text: string) {
    if (!sessionId || isStreaming) return
    addMessage({ id: uuid(), role: 'user', text, toolCalls: [], timestamp: Date.now() })
    const aId = uuid()
    addMessage({ id: aId, role: 'assistant', text: '', toolCalls: [], isStreaming: true, timestamp: Date.now() })
    setIsStreaming(true)
    abortRef.current = new AbortController()

    try {
      for await (const event of streamChatFetch(sessionId, text, {}, abortRef.current.signal)) {
        switch (event.type) {
          case 'text_delta':
            updateLastAssistant(m => ({ ...m, text: m.text + event.text }))
            break
          case 'tool_use_start': {
            const tc: ToolCall = { id: event.id, name: event.name, input: event.input, status: 'running' }
            updateLastAssistant(m => ({ ...m, toolCalls: [...m.toolCalls, tc] }))
            break
          }
          case 'tool_result':
            updateLastAssistant(m => ({
              ...m,
              toolCalls: m.toolCalls.map(tc =>
                tc.id === event.toolUseId
                  ? { ...tc, status: event.isError ? 'error' : 'done', result: event.result, isError: event.isError }
                  : tc
              ),
            }))
            break
          case 'turn_complete':
            updateLastAssistant(m => ({ ...m, usage: event.usage }))
            break
          case 'permission_request':
            setPermRequest({ requestId: event.requestId, toolName: event.toolName, input: event.input, message: event.message, riskLevel: event.riskLevel })
            break
          case 'error':
            updateLastAssistant(m => ({ ...m, text: m.text + (m.text ? '\n\n' : '') + `⚠ ${event.message || 'Error'}`, isStreaming: false }))
            break
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        updateLastAssistant(m => ({ ...m, text: m.text + '\n\n⚠ Connection error' }))
      }
    } finally {
      updateLastAssistant(m => ({ ...m, isStreaming: false }))
      setIsStreaming(false)
      abortRef.current = null
      if (sessionId) createSession({ sessionId }).then(setSessionInfo)
    }
  }

  async function newSession() {
    const info = await createSession()
    setSessionId(info.id); setSessionInfo(info); setMessages([])
    getSessions().then(d => setRecentSessions(d.history || []))
  }

  async function resumeSession(sid: string) {
    const info = await createSession({ resumeSessionId: sid })
    setSessionId(info.id); setSessionInfo(info)
    setMessages([{ id: uuid(), role: 'system', text: `resumed ${sid.slice(0, 8)}…`, toolCalls: [], timestamp: Date.now() }])
  }

  async function handleCompact() {
    if (!sessionId) return
    const r = await compactSession(sessionId)
    if (r.ok) {
      addMessage({ id: uuid(), role: 'system', text: `compacted ${r.preTokens?.toLocaleString()} → ${r.postTokens?.toLocaleString()} tokens`, toolCalls: [], timestamp: Date.now() })
    }
  }

  function togglePanel(p: 'sessions' | 'config') {
    setActivePanel(cur => cur === p ? null : p)
  }

  const QUICK_PROMPTS = ['list files in src/', 'git status', 'read package.json', '帮我写一个 hello.ts']

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Sidebar */}
      <Sidebar
        sessionId={sessionId}
        sessionInfo={sessionInfo}
        recentSessions={recentSessions}
        onNew={newSession}
        onResume={resumeSession}
        onCompact={handleCompact}
        isStreaming={isStreaming}
        activePanel={activePanel}
        onTogglePanel={togglePanel}
      />

      {/* Config panel (slides in from sidebar) */}
      {activePanel === 'config' && (
        <div
          className="slide-in"
          style={{
            width: 300,
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            boxShadow: 'var(--shadow)',
          }}
        >
          <ConfigPanel onClose={() => setActivePanel(null)} />
        </div>
      )}

      {/* Main chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Topbar */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            height: 48,
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {sessionInfo && (
              <span
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-geist-mono)',
                  color: 'var(--text-muted)',
                  padding: '2px 7px',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                }}
              >
                {sessionInfo.model.split('-').slice(-2).join('-')}
              </span>
            )}
            {isStreaming && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ display: 'flex', gap: 3 }}>
                  {[0, 1, 2].map(i => (
                    <span
                      key={i}
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        background: 'var(--text-secondary)',
                        display: 'inline-block',
                        animation: `pulse-dot 1s ease-in-out ${i * 0.15}s infinite`,
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>thinking</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isStreaming && (
              <button
                className="btn"
                onClick={() => abortRef.current?.abort()}
                style={{ fontSize: 11 }}
              >
                Stop
              </button>
            )}
            <button className="btn btn-ghost" onClick={toggle} title="Toggle theme">
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </header>

        {/* Messages */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 20px 8px',
          }}
        >
          <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {messages.length === 0 && (
              <div
                className="fade-up"
                style={{ textAlign: 'center', marginTop: 60 }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 48,
                    height: 48,
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    marginBottom: 16,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                  mini-claude-code
                </h2>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  AI coding assistant — ask me to read files, write code, run commands
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                  {QUICK_PROMPTS.map(p => (
                    <button
                      key={p}
                      onClick={() => sendMessage(p)}
                      className="btn"
                      style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11 }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map(msg => <MessageItem key={msg.id} message={msg} />)}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Input */}
        <footer
          style={{
            flexShrink: 0,
            padding: '10px 20px 14px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            <ChatInput
              onSend={sendMessage}
              disabled={isStreaming || !sessionId}
            />
            <div
              style={{
                marginTop: 6,
                display: 'flex',
                justifyContent: 'center',
                gap: 12,
                fontSize: 10,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-geist-mono)',
              }}
            >
              <span>Enter to send</span>
              <span>·</span>
              <span>Shift+Enter for newline</span>
              <span>·</span>
              <span>{process.env.NEXT_PUBLIC_API_URL || 'localhost:3001'}</span>
            </div>
          </div>
        </footer>
      </div>

      {/* Permission dialog */}
      {permRequest && (
        <PermissionDialog request={permRequest} onResolved={() => setPermRequest(null)} />
      )}
    </div>
  )
}
