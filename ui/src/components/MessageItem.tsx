'use client'

import type { ChatMessage } from '@/lib/types'
import ToolCallCard from './ToolCallCard'

export default function MessageItem({ message: m }: { message: ChatMessage }) {
  const isUser = m.role === 'user'
  const isSystem = m.role === 'system'

  /* system: code-comment annotation */
  if (isSystem)
    return (
      <div
        id={`msg-${m.id}`}
        className="a-up"
        style={{ display: 'flex', paddingTop: 6, paddingBottom: 6 }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-geist-mono)',
            color: 'var(--text-2)',
          }}
        >
          {m.text}
        </span>
      </div>
    )

  return (
    <div
      id={`msg-${m.id}`}
      className="a-up"
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        paddingBottom: isUser ? 12 : 10,
      }}
    >
      <div
        style={{
          maxWidth: 'min(92%, 520px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: isUser ? 'flex-end' : 'flex-start',
        }}
      >
        {(m.text || m.isStreaming) && (
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.65,
              color: 'var(--text)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              ...(isUser
                ? {
                    padding: '12px 16px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border-2)',
                    borderRadius: 14,
                    boxShadow: 'var(--shadow-sm)',
                  }
                : {
                    padding: '4px 2px',
                    fontFamily: 'var(--font-geist-sans)',
                  }),
            }}
          >
            {m.text}
            {m.isStreaming && <span className="cursor" />}
          </div>
        )}

        {m.toolCalls.length > 0 && (
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {m.toolCalls.map(tc => (
              <ToolCallCard key={tc.id} call={tc} />
            ))}
          </div>
        )}

        {m.usage && !m.isStreaming && (
          <div className="label" style={{ color: 'var(--text-3)' }}>
            {m.usage.inputTokens.toLocaleString()}↑ {m.usage.outputTokens.toLocaleString()}↓
          </div>
        )}
      </div>
    </div>
  )
}
