'use client'

import type { ChatMessage } from '@/lib/types'
import ToolCallCard from './ToolCallCard'

interface Props { message: ChatMessage }

export default function MessageItem({ message }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="fade-up" style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            padding: '3px 12px',
            border: '1px solid var(--border)',
            borderRadius: 20,
            background: 'var(--bg-elevated)',
          }}
        >
          {message.text}
        </span>
      </div>
    )
  }

  return (
    <div
      className="fade-up"
      style={{
        display: 'flex',
        gap: 10,
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
      }}
    >
      {/* Avatar */}
      <div
        className="mono"
        style={{
          width: 26,
          height: 26,
          border: '1px solid var(--border)',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          color: 'var(--text-secondary)',
          flexShrink: 0,
          marginTop: 2,
          background: 'var(--bg-elevated)',
          letterSpacing: '-0.02em',
        }}
      >
        {isUser ? 'you' : 'ai'}
      </div>

      {/* Content */}
      <div
        style={{
          maxWidth: '78%',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          alignItems: isUser ? 'flex-end' : 'flex-start',
        }}
      >
        {/* Text bubble */}
        {(message.text || message.isStreaming) && (
          <div
            style={{
              padding: '9px 13px',
              borderRadius: isUser ? '8px 2px 8px 8px' : '2px 8px 8px 8px',
              fontSize: 14,
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              ...(isUser
                ? {
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    boxShadow: 'var(--shadow-sm)',
                  }
                : {
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    padding: '2px 0',
                  }),
            }}
          >
            {message.text}
            {message.isStreaming && <span className="cursor-blink" />}
          </div>
        )}

        {/* Tool calls */}
        {message.toolCalls.length > 0 && (
          <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {message.toolCalls.map(tc => (
              <ToolCallCard key={tc.id} call={tc} />
            ))}
          </div>
        )}

        {/* Token usage */}
        {message.usage && !message.isStreaming && (
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              padding: '0 2px',
            }}
          >
            {message.usage.inputTokens.toLocaleString()}↑ {message.usage.outputTokens.toLocaleString()}↓
          </div>
        )}
      </div>
    </div>
  )
}
