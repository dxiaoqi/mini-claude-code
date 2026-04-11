'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createSession, streamChatFetch, getSessions, compactSession } from '@/lib/api'
import type { SessionInfo } from '@/lib/api'
import type { ChatMessage, PermissionRequest, ToolCall } from '@/lib/types'
import MessageItem from '@/components/MessageItem'
import ChatInput from '@/components/ChatInput'
import PermissionDialog from '@/components/PermissionDialog'
import { v4 as uuid } from 'uuid'

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [permRequest, setPermRequest] = useState<PermissionRequest | null>(null)
  const [recentSessions, setRecentSessions] = useState<{ sessionId: string; modifiedAt: string }[]>([])
  const [showSessions, setShowSessions] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Init session
  useEffect(() => {
    createSession().then(info => {
      setSessionId(info.id)
      setSessionInfo(info)
    })
    getSessions().then(data => setRecentSessions(data.history || []))
  }, [])

  // Auto-scroll
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
        if (last[i].role === 'assistant') {
          last[i] = updater(last[i])
          break
        }
      }
      return last
    })
  }

  async function sendMessage(text: string) {
    if (!sessionId || isStreaming) return

    // Add user message
    addMessage({ id: uuid(), role: 'user', text, toolCalls: [], timestamp: Date.now() })

    // Add empty assistant message
    const assistantId = uuid()
    addMessage({ id: assistantId, role: 'assistant', text: '', toolCalls: [], isStreaming: true, timestamp: Date.now() })

    setIsStreaming(true)
    abortRef.current = new AbortController()

    try {
      for await (const event of streamChatFetch(sessionId, text, {}, abortRef.current.signal)) {
        switch (event.type) {
          case 'text_delta':
            updateLastAssistant(msg => ({ ...msg, text: msg.text + event.text }))
            break

          case 'tool_use_start': {
            const newCall: ToolCall = {
              id: event.id,
              name: event.name,
              input: event.input,
              status: 'running',
            }
            updateLastAssistant(msg => ({
              ...msg,
              toolCalls: [...msg.toolCalls, newCall],
            }))
            break
          }

          case 'tool_result': {
            updateLastAssistant(msg => ({
              ...msg,
              toolCalls: msg.toolCalls.map(tc =>
                tc.id === event.toolUseId
                  ? { ...tc, status: event.isError ? 'error' : 'done', result: event.result, isError: event.isError }
                  : tc
              ),
            }))
            break
          }

          case 'turn_complete':
            updateLastAssistant(msg => ({ ...msg, usage: event.usage }))
            break

          case 'permission_request':
            setPermRequest({
              requestId: event.requestId,
              toolName: event.toolName,
              input: event.input,
              message: event.message,
              riskLevel: event.riskLevel,
            })
            break

          case 'error':
            updateLastAssistant(msg => ({
              ...msg,
              text: msg.text + (msg.text ? '\n\n' : '') + `⚠️ ${event.message || event.error?.message || 'Unknown error'}`,
              isStreaming: false,
            }))
            break

          case 'done':
            break
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        updateLastAssistant(msg => ({
          ...msg,
          text: msg.text + '\n\n⚠️ Connection error',
        }))
      }
    } finally {
      updateLastAssistant(msg => ({ ...msg, isStreaming: false }))
      setIsStreaming(false)
      abortRef.current = null
      // Refresh session info
      if (sessionId) {
        createSession({ sessionId }).then(info => setSessionInfo(info))
      }
    }
  }

  function stopStreaming() {
    abortRef.current?.abort()
  }

  async function newSession() {
    const info = await createSession()
    setSessionId(info.id)
    setSessionInfo(info)
    setMessages([])
  }

  async function resumeSession(sid: string) {
    const info = await createSession({ resumeSessionId: sid })
    setSessionId(info.id)
    setSessionInfo(info)
    setMessages([{ id: uuid(), role: 'system', text: `✓ Resumed session ${sid.slice(0, 8)}…`, toolCalls: [], timestamp: Date.now() }])
    setShowSessions(false)
  }

  async function handleCompact() {
    if (!sessionId) return
    const result = await compactSession(sessionId)
    if (result.ok) {
      addMessage({
        id: uuid(), role: 'system',
        text: `✓ Compacted: ${result.preTokens?.toLocaleString()} → ${result.postTokens?.toLocaleString()} tokens`,
        toolCalls: [], timestamp: Date.now(),
      })
    }
  }

  const costStr = sessionInfo
    ? sessionInfo.totalCostUSD < 0.001
      ? `$0.00`
      : `$${sessionInfo.totalCostUSD.toFixed(4)}`
    : ''

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-zinc-100">mini-claude-code</span>
          {sessionInfo && (
            <span className="text-xs text-zinc-500 font-mono">
              {sessionInfo.id.slice(0, 8)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {sessionInfo && (
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span>{(sessionInfo.totalInputTokens + sessionInfo.totalOutputTokens).toLocaleString()} tokens</span>
              <span>{costStr}</span>
              <span className="font-mono">{sessionInfo.model}</span>
            </div>
          )}

          <button
            onClick={handleCompact}
            disabled={isStreaming || !sessionId}
            className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 transition-colors"
          >
            /compact
          </button>

          <button
            onClick={() => { setShowSessions(!showSessions); getSessions().then(d => setRecentSessions(d.history || [])) }}
            className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            Sessions
          </button>

          <button
            onClick={newSession}
            className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            New
          </button>
        </div>
      </header>

      {/* Sessions dropdown */}
      {showSessions && (
        <div className="absolute right-4 top-14 z-40 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl overflow-hidden">
          <div className="p-3 border-b border-zinc-700">
            <p className="text-xs text-zinc-400 font-medium">Recent Sessions</p>
          </div>
          {recentSessions.length === 0 ? (
            <p className="p-4 text-xs text-zinc-500">No history yet</p>
          ) : (
            <ul className="max-h-72 overflow-auto">
              {recentSessions.map(s => (
                <li key={s.sessionId}>
                  <button
                    onClick={() => resumeSession(s.sessionId)}
                    className="w-full text-left px-4 py-2.5 hover:bg-zinc-800 transition-colors text-xs"
                  >
                    <span className="font-mono text-zinc-300">{s.sessionId.slice(0, 16)}…</span>
                    <span className="block text-zinc-500 mt-0.5">
                      {new Date(s.modifiedAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-5">
          {messages.length === 0 && (
            <div className="text-center mt-20">
              <div className="text-4xl mb-4">⚡</div>
              <h2 className="text-xl font-semibold text-zinc-300 mb-2">mini-claude-code</h2>
              <p className="text-zinc-500 text-sm">AI coding assistant. Ask me to read files, write code, run commands...</p>
              <div className="mt-6 flex flex-wrap gap-2 justify-center">
                {['读取 package.json', '列出 src/ 下所有文件', 'git status', '帮我创建一个 hello.py'].map(s => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map(msg => (
            <MessageItem key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input area */}
      <footer className="shrink-0 px-4 py-4 border-t border-zinc-800">
        <div className="max-w-3xl mx-auto">
          {isStreaming ? (
            <div className="flex items-center gap-3 mb-3">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
              </div>
              <span className="text-xs text-zinc-500">Thinking…</span>
              <button onClick={stopStreaming} className="text-xs text-red-400 hover:text-red-300 ml-auto">
                Stop
              </button>
            </div>
          ) : null}
          <ChatInput
            onSend={sendMessage}
            disabled={isStreaming || !sessionId}
            placeholder="Message mini-claude… (Enter to send, Shift+Enter for newline, @file.ts to attach)"
          />
          <p className="text-[10px] text-zinc-600 mt-2 text-center">
            mini-claude-code Web UI · Server: {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}
          </p>
        </div>
      </footer>

      {/* Permission dialog */}
      {permRequest && (
        <PermissionDialog
          request={permRequest}
          onResolved={() => setPermRequest(null)}
        />
      )}

      {/* Click outside to close sessions */}
      {showSessions && (
        <div className="fixed inset-0 z-30" onClick={() => setShowSessions(false)} />
      )}
    </div>
  )
}
