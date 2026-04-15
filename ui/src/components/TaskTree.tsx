'use client'

import type { ChatMessage } from '@/lib/types'

export type TurnOutline = {
  userMsgId: string
  preview: string
  toolLabels: string[]
  streaming: boolean
  hasAssistant: boolean
}

function buildTurns(messages: ChatMessage[]): TurnOutline[] {
  const turns: TurnOutline[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const next = messages[i + 1]
    const assistant = next?.role === 'assistant' ? next : undefined
    turns.push({
      userMsgId: m.id,
      preview: m.text.replace(/\s+/g, ' ').trim().slice(0, 48) || '(empty)',
      toolLabels: assistant?.toolCalls.map(t => t.name) ?? [],
      streaming: assistant?.isStreaming ?? false,
      hasAssistant: !!assistant,
    })
    if (assistant) i++
  }
  return turns
}

export default function TaskTree({
  messages,
  onSelectUserMessage,
}: {
  messages: ChatMessage[]
  onSelectUserMessage?: (userMsgId: string) => void
}) {
  const turns = buildTurns(messages)

  return (
    <aside
      style={{
        width: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        fontSize: 11,
        fontFamily: 'var(--font-geist-mono)',
        color: 'var(--text-2)',
        userSelect: 'none',
      }}
    >
      <div className="label" style={{ marginBottom: 10, letterSpacing: '.14em' }}>
        Outline
      </div>

      {/* root */}
      <div style={{ position: 'relative', paddingLeft: 14 }}>
        <span
          style={{
            position: 'absolute',
            left: 3,
            top: 6,
            width: 5,
            height: 5,
            borderRadius: '50%',
            border: '1px solid var(--border-2)',
            background: 'var(--surface)',
          }}
        />
        <div style={{ fontSize: 10, color: 'var(--text)', paddingBottom: 8 }}>
          Session
        </div>

        {turns.length === 0 && (
          <div
            style={{
              paddingLeft: 12,
              borderLeft: '1px solid var(--tree-line)',
              marginLeft: 2,
              paddingBottom: 8,
              color: 'var(--text-3)',
              lineHeight: 1.5,
            }}
          >
            Waiting for input
          </div>
        )}

        {turns.map((t, idx) => (
          <div
            key={t.userMsgId}
            style={{
              marginBottom: idx === turns.length - 1 ? 0 : 4,
              paddingLeft: 12,
              borderLeft: '1px solid var(--tree-line)',
              marginLeft: 2,
            }}
          >
            <button
              type="button"
              onClick={() => onSelectUserMessage?.(t.userMsgId)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: '4px 0 6px',
                cursor: onSelectUserMessage ? 'pointer' : 'default',
                color: 'inherit',
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  marginTop: 3,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  border: '1px solid var(--border-2)',
                  background:
                    t.streaming ? 'var(--text-2)' : t.hasAssistant ? 'var(--text)' : 'transparent',
                  boxShadow: t.streaming ? '0 0 0 3px rgba(0,0,0,.06)' : undefined,
                }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="label" style={{ display: 'block', marginBottom: 2 }}>
                  Turn {idx + 1}
                </span>
                <span
                  style={{
                    color: 'var(--text)',
                    lineHeight: 1.45,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {t.preview}
                </span>
              </span>
            </button>

            {t.toolLabels.length > 0 && (
              <ul style={{ margin: '0 0 8px 0', padding: '0 0 0 14px', listStyle: 'none' }}>
                {t.toolLabels.map((name, ti) => (
                  <li
                    key={`${t.userMsgId}-${name}-${ti}`}
                    style={{
                      position: 'relative',
                      padding: '3px 0 3px 12px',
                      fontSize: 10,
                      color: 'var(--text-2)',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: '50%',
                        width: 8,
                        height: 1,
                        background: 'var(--tree-line)',
                        transform: 'translateY(-50%)',
                      }}
                    />
                    <span
                      style={{
                        display: 'inline-block',
                        width: 4,
                        height: 4,
                        marginRight: 6,
                        borderRadius: 1,
                        background: 'var(--text-2)',
                        verticalAlign: 'middle',
                        opacity: 0.35,
                      }}
                    />
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
