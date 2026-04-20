/**
 * POST /api/chat
 * Streaming SSE endpoint for Visual mode — runs Orchestrator and sends UIEvents.
 * Agent mode connects directly to lino HTTP server (bypasses this route).
 */

import { NextRequest } from 'next/server'
import { stateStore } from '@/lib/state-store'
import { runVisualOrchestrator } from '@/lib/orchestrator'
import type { UIEvent } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { message, conversationId: reqConvId, sessionId: reqSessionId } = body as {
    message?: string
    conversationId?: string
    sessionId?: string
  }

  if (!message?.trim()) {
    return new Response('Missing message', { status: 400 })
  }

  // Session + Conversation setup
  const session = stateStore.getOrCreateSession(reqSessionId || 'default')
  let conversation = reqConvId ? stateStore.getConversation(reqConvId) : null
  if (!conversation) {
    conversation = stateStore.createConversation(session.id, message.slice(0, 50))
  }

  // Create turn + artifact
  const turn = stateStore.createTurn(conversation.id, message)
  const artifact = stateStore.createArtifact(turn.id)

  const convId = conversation.id
  const turnId = turn.id
  const artifactId = artifact.id

  // SSE stream
  const encoder = new TextEncoder()
  const abortController = new AbortController()

  const stream = new ReadableStream({
    async start(controller) {
      // Send flat UIEvent with metadata merged in
      const send = (event: UIEvent) => {
        try {
          const data = `data: ${JSON.stringify({ ...event, conversationId: convId, turnId, artifactId })}\n\n`
          controller.enqueue(encoder.encode(data))
        } catch {
          // controller closed
        }
      }

      // Initial status
      send({ type: 'status', message: '连接成功，正在初始化...' } as UIEvent)

      try {
        await runVisualOrchestrator({
          conversationId: convId,
          turnId,
          artifactId,
          userInput: message,
          signal: abortController.signal,
          onEvent: send,
        })
      } catch (err: unknown) {
        send({ type: 'error.occurred', message: (err as Error)?.message || '生成失败' } as UIEvent)
      }

      // Done sentinel
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', artifactId })}\n\n`))
      controller.close()
    },
    cancel() {
      abortController.abort()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

// GET for conversation history
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const conversationId = searchParams.get('conversationId')
  const sessionId = searchParams.get('sessionId') || 'default'

  if (conversationId) {
    const turns = stateStore.listTurns(conversationId)
    const result = turns.map(t => {
      const artifact = t.artifactId ? stateStore.getArtifact(t.artifactId) : null
      return {
        turn: t,
        artifact: artifact ? {
          id: artifact.id,
          status: artifact.status,
          widgets: artifact.widgets,
        } : null
      }
    })
    return Response.json({ turns: result })
  }

  const session = stateStore.getOrCreateSession(sessionId)
  const conversations = stateStore.listConversations(session.id)
  return Response.json({ conversations, sessionId: session.id })
}
