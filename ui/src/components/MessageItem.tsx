'use client'

import type { ChatMessage } from '@/lib/types'
import ToolCallCard from './ToolCallCard'

export default function MessageItem({ message: m }: { message: ChatMessage }) {
  const isUser   = m.role === 'user'
  const isSystem = m.role === 'system'

  if (isSystem) return (
    <div className="in-up" style={{ display: 'flex', justifyContent: 'center' }}>
      <span style={{
        fontSize: 11, color: 'var(--text-3)',
        padding: '2px 10px',
        border: '1px solid var(--border)', borderRadius: 20,
      }}>
        {m.text}
      </span>
    </div>
  )

  return (
    <div className="in-up" style={{ display: 'flex', gap: 10, flexDirection: isUser ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
      {/* avatar */}
      <div style={{
        width: 24, height: 24, flexShrink: 0, marginTop: 3,
        border: '1px solid var(--border)', borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontFamily: 'var(--font-geist-mono)', color: 'var(--text-3)',
        background: 'var(--surface)',
      }}>
        {isUser ? 'you' : 'ai'}
      </div>

      {/* content */}
      <div style={{ maxWidth: '76%', display: 'flex', flexDirection: 'column', gap: 5, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        {(m.text || m.isStreaming) && (
          <div style={{
            fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            ...(isUser
              ? { padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px 2px 8px 8px', boxShadow: 'var(--shadow)', color: 'var(--text)' }
              : { color: 'var(--text)' }),
          }}>
            {m.text}
            {m.isStreaming && <span className="cursor"/>}
          </div>
        )}

        {m.toolCalls.length > 0 && (
          <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {m.toolCalls.map(tc => <ToolCallCard key={tc.id} call={tc} />)}
          </div>
        )}

        {m.usage && !m.isStreaming && (
          <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-geist-mono)' }}>
            {m.usage.inputTokens.toLocaleString()}↑ {m.usage.outputTokens.toLocaleString()}↓
          </div>
        )}
      </div>
    </div>
  )
}
