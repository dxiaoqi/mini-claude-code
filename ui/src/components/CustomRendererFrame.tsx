'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import {
  type RendererConfig,
  type RendererMessage,
  type HostMessage,
  isRendererMessage,
  sendToRenderer,
} from '@/lib/custom-renderer'

interface Props {
  config: RendererConfig
  sessionId: string | null
  model: string
  /** Called when renderer sends SEND_MESSAGE */
  onSendMessage: (text: string, context?: unknown) => void
  /** Called when renderer sends UPDATE_SYSTEM_PROMPT */
  onUpdateSystemPrompt: (addendum: string) => void
  /** Called when renderer sends PERMISSION_RESPONSE */
  onPermissionResponse: (requestId: string, decision: 'allow' | 'deny') => void
  /** Ref exposed to parent so it can forward STREAM_EVENTs */
  frameRef?: React.RefObject<CustomRendererFrameHandle | null>
}

export interface CustomRendererFrameHandle {
  sendStreamEvent: (event: Record<string, unknown>) => void
  sendContextUpdate: (model?: string, sessionId?: string) => void
}

export function CustomRendererFrame({
  config,
  sessionId,
  model,
  onSendMessage,
  onUpdateSystemPrompt,
  onPermissionResponse,
  frameRef,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const pendingEventsRef = useRef<Array<Record<string, unknown>>>([])

  // Expose imperative handle to parent
  useEffect(() => {
    if (!frameRef) return
    ;(frameRef as React.MutableRefObject<CustomRendererFrameHandle>).current = {
      sendStreamEvent(event) {
        if (ready) {
          sendToRenderer(iframeRef.current, { type: 'STREAM_EVENT', payload: event })
        } else {
          pendingEventsRef.current.push(event)
        }
      },
      sendContextUpdate(m, s) {
        sendToRenderer(iframeRef.current, {
          type: 'CONTEXT_UPDATE',
          payload: { model: m, sessionId: s },
        })
      },
    }
  }, [ready, frameRef])

  // Send SESSION_INIT once renderer signals ready (sessionId may be null initially)
  const initSent = useRef(false)
  useEffect(() => {
    if (!ready || initSent.current) return
    initSent.current = true
    sendToRenderer(iframeRef.current, {
      type: 'SESSION_INIT',
      payload: {
        sessionId: sessionId ?? '',
        model,
        rendererConfig: {
          name: config.name ?? config.url,
          description: config.description,
          inputMode: config.inputMode ?? 'host',
        },
      },
    } satisfies HostMessage)

    // Flush any events that arrived before ready
    for (const ev of pendingEventsRef.current) {
      sendToRenderer(iframeRef.current, { type: 'STREAM_EVENT', payload: ev })
    }
    pendingEventsRef.current = []
  }, [ready, model, config])

  // Push sessionId update to renderer when it becomes available
  useEffect(() => {
    if (!ready || !sessionId) return
    sendToRenderer(iframeRef.current, {
      type: 'CONTEXT_UPDATE',
      payload: { sessionId, model },
    })
  }, [ready, sessionId, model])

  // Push theme updates
  useEffect(() => {
    const pushTheme = () => {
      if (!iframeRef.current?.contentWindow) return
      const cs = getComputedStyle(document.documentElement)
      const vars = [
        '--bg-primary', '--bg-secondary', '--text-primary', '--text-secondary',
        '--accent', '--border-default', '--font-sans',
      ]
      const cssVars = ':root{' + vars
        .map(v => { const val = cs.getPropertyValue(v).trim(); return val ? `${v}:${val}` : null })
        .filter(Boolean).join(';') + '}'
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
      sendToRenderer(iframeRef.current, { type: 'THEME_UPDATE', payload: { cssVars, isDark } })
    }
    const observer = new MutationObserver(pushTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // Handle messages from renderer
  const handleMessage = useCallback((e: MessageEvent) => {
    // Accept RENDERER_READY from any source matching the renderer URL origin,
    // since the iframe contentWindow ref may not be set yet when the first message arrives.
    if (!isRendererMessage(e.data)) return
    const msg = e.data as RendererMessage

    if (msg.type === 'RENDERER_READY') {
      setReady(true)
      return
    }

    // For all other messages, verify the source is our iframe
    if (e.source !== iframeRef.current?.contentWindow) return

    switch (msg.type) {
      case 'SEND_MESSAGE':
        onSendMessage(msg.payload.text, msg.payload.context)
        break
      case 'UPDATE_SYSTEM_PROMPT':
        onUpdateSystemPrompt(msg.payload.addendum)
        break
      case 'PERMISSION_RESPONSE':
        onPermissionResponse(msg.payload.requestId, msg.payload.decision)
        break
      case 'OPEN_LINK':
        window.open(msg.payload, '_blank', 'noopener,noreferrer')
        break
    }
  }, [onSendMessage, onUpdateSystemPrompt, onPermissionResponse])

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {!ready && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-primary)',
          color: 'var(--text-tertiary)',
          fontSize: 13,
          zIndex: 1,
        }}>
          <span>正在连接渲染器…</span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={config.url}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          opacity: ready ? 1 : 0,
          transition: 'opacity 200ms ease',
        }}
        title={config.name ?? 'Custom Renderer'}
      />
    </div>
  )
}
