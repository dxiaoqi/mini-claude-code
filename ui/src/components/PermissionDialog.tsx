'use client'

import { respondPermission } from '@/lib/api'
import type { PermissionRequest } from '@/lib/types'

interface Props {
  request: PermissionRequest
  onResolved: () => void
}

const RISK_COLORS: Record<string, string> = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-red-400',
}

export default function PermissionDialog({ request, onResolved }: Props) {
  async function respond(decision: 'allow' | 'allow_always' | 'deny') {
    await respondPermission(request.requestId, decision)
    onResolved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-400 text-sm">
            🔒
          </div>
          <div>
            <h3 className="font-semibold text-zinc-100">Permission Required</h3>
            <p className="text-xs text-zinc-400">
              Tool:{' '}
              <span className="font-mono text-zinc-300">{request.toolName}</span>
              {' · '}
              <span className={RISK_COLORS[request.riskLevel] || 'text-yellow-400'}>
                {request.riskLevel} risk
              </span>
            </p>
          </div>
        </div>

        {/* Request message */}
        {request.message && (
          <p className="text-sm text-zinc-300 mb-4 leading-relaxed">{request.message}</p>
        )}

        {/* Input preview */}
        {Object.keys(request.input).length > 0 && (
          <div className="bg-zinc-950 rounded-lg p-3 mb-5 font-mono text-xs text-zinc-300 overflow-auto max-h-32">
            {JSON.stringify(request.input, null, 2)}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => respond('deny')}
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => respond('allow')}
            className="flex-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            Allow
          </button>
          <button
            onClick={() => respond('allow_always')}
            className="flex-1 px-3 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-medium transition-colors"
          >
            Always Allow
          </button>
        </div>
      </div>
    </div>
  )
}
