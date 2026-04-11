'use client'

import { useState } from 'react'
import type { ToolCall } from '@/lib/types'

const TOOL_ICONS: Record<string, string> = {
  Bash: '⚡',
  FileRead: '📖',
  FileEdit: '✏️',
  FileWrite: '💾',
  Glob: '🔍',
  Grep: '🔎',
  WebFetch: '🌐',
  Agent: '🤖',
  TodoWrite: '✅',
  default: '🔧',
}

export default function ToolCallCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const icon = TOOL_ICONS[call.name] || TOOL_ICONS.default

  const statusColor =
    call.status === 'running' ? 'text-yellow-400' :
    call.status === 'error' ? 'text-red-400' :
    'text-green-400'

  const statusDot =
    call.status === 'running' ? 'animate-pulse bg-yellow-400' :
    call.status === 'error' ? 'bg-red-400' :
    'bg-green-400'

  // Format input preview
  const inputPreview = Object.entries(call.input)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}${String(v).length > 60 ? '…' : ''}`)
    .join(' · ')

  // Format result
  const resultText = call.result
    ? typeof call.result === 'string'
      ? call.result
      : JSON.stringify(call.result)
    : null

  return (
    <div
      className={`rounded-lg border text-xs font-mono cursor-pointer transition-colors
        ${call.status === 'running' ? 'border-yellow-500/30 bg-yellow-500/5' :
          call.isError ? 'border-red-500/30 bg-red-500/5' :
          'border-zinc-700/50 bg-zinc-800/30'}`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span>{icon}</span>
        <span className="font-medium text-zinc-200">{call.name}</span>
        <span className="text-zinc-500 truncate flex-1">{inputPreview}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          <span className={`${statusColor} capitalize`}>{call.status}</span>
        </div>
        <span className="text-zinc-600">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded input */}
      {expanded && (
        <div className="border-t border-zinc-700/50">
          <div className="px-3 py-2">
            <p className="text-zinc-500 mb-1 text-[10px] uppercase tracking-wider">Input</p>
            <pre className="text-zinc-300 whitespace-pre-wrap overflow-auto max-h-40">
              {JSON.stringify(call.input, null, 2)}
            </pre>
          </div>

          {resultText && (
            <div className="px-3 py-2 border-t border-zinc-700/50">
              <p className="text-zinc-500 mb-1 text-[10px] uppercase tracking-wider">
                {call.isError ? 'Error' : 'Result'}
              </p>
              <pre className={`whitespace-pre-wrap overflow-auto max-h-48
                ${call.isError ? 'text-red-300' : 'text-zinc-300'}`}>
                {resultText.slice(0, 2000)}{resultText.length > 2000 ? '\n…(truncated)' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
