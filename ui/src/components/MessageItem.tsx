'use client'

import type { ChatMessage } from '@/lib/types'
import ToolCallCard from './ToolCallCard'

interface Props {
  message: ChatMessage
}

export default function MessageItem({ message }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-zinc-500 bg-zinc-800/50 px-3 py-1 rounded-full">
          {message.text}
        </span>
      </div>
    )
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 mt-1
        ${isUser ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}>
        {isUser ? 'U' : 'AI'}
      </div>

      {/* Bubble */}
      <div className={`max-w-[80%] flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Text */}
        {(message.text || message.isStreaming) && (
          <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
            ${isUser
              ? 'bg-blue-600 text-white rounded-tr-sm'
              : 'bg-zinc-800 text-zinc-100 rounded-tl-sm'}`}>
            {message.text}
            {message.isStreaming && (
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-zinc-400 animate-pulse align-middle" />
            )}
          </div>
        )}

        {/* Tool calls */}
        {message.toolCalls.length > 0 && (
          <div className="w-full max-w-lg flex flex-col gap-1.5">
            {message.toolCalls.map(tc => (
              <ToolCallCard key={tc.id} call={tc} />
            ))}
          </div>
        )}

        {/* Usage */}
        {message.usage && !message.isStreaming && (
          <div className="text-[10px] text-zinc-600 px-1">
            {message.usage.inputTokens}↑ {message.usage.outputTokens}↓ tokens
          </div>
        )}
      </div>
    </div>
  )
}
