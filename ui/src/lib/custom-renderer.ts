/**
 * Custom Renderer postMessage protocol.
 * Defines all message types exchanged between the blino host and a user-provided renderer iframe.
 */

// ── Config (mirrors server-side RendererConfig) ────────────────────────────

export interface RendererConfig {
  url: string
  name?: string
  description?: string
  inputMode?: 'host' | 'renderer'
}

// ── Host → Renderer messages ───────────────────────────────────────────────

export interface SessionInitMessage {
  type: 'SESSION_INIT'
  payload: {
    sessionId: string
    model: string
    rendererConfig: {
      name: string
      description?: string
      inputMode: 'host' | 'renderer'
    }
  }
}

export interface StreamEventMessage {
  type: 'STREAM_EVENT'
  payload: Record<string, unknown>  // UIEvent — typed loosely to avoid circular dep
}

export interface ContextUpdateMessage {
  type: 'CONTEXT_UPDATE'
  payload: {
    model?: string
    sessionId?: string
  }
}

export interface ThemeUpdateMessage {
  type: 'THEME_UPDATE'
  payload: {
    cssVars: string
    isDark: boolean
  }
}

export type HostMessage =
  | SessionInitMessage
  | StreamEventMessage
  | ContextUpdateMessage
  | ThemeUpdateMessage

// ── Renderer → Host messages ───────────────────────────────────────────────

export interface RendererReadyMessage {
  type: 'RENDERER_READY'
  payload?: { version?: string }
}

export interface SendMessageMessage {
  type: 'SEND_MESSAGE'
  payload: {
    text: string
    context?: unknown
  }
}

export interface UpdateSystemPromptMessage {
  type: 'UPDATE_SYSTEM_PROMPT'
  payload: {
    addendum: string
  }
}

export interface PermissionResponseMessage {
  type: 'PERMISSION_RESPONSE'
  payload: {
    requestId: string
    decision: 'allow' | 'deny'
  }
}

export interface RendererResizeMessage {
  type: 'RESIZE'
  payload: number
}

export interface OpenLinkMessage {
  type: 'OPEN_LINK'
  payload: string
}

export type RendererMessage =
  | RendererReadyMessage
  | SendMessageMessage
  | UpdateSystemPromptMessage
  | PermissionResponseMessage
  | RendererResizeMessage
  | OpenLinkMessage

// ── Type guard ─────────────────────────────────────────────────────────────

export function isRendererMessage(data: unknown): data is RendererMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>).type === 'string'
  )
}

// ── Sender helpers (host side) ─────────────────────────────────────────────

export function sendToRenderer(
  iframe: HTMLIFrameElement | null,
  message: HostMessage,
): void {
  if (!iframe?.contentWindow) return
  iframe.contentWindow.postMessage(message, '*')
}
