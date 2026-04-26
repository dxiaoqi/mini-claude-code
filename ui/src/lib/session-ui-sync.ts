/**
 * 将工作流等 UI 产出的消息同步到 Blino 会话 state（见 POST /api/sessions/:id/ui-message），
 * 避免刷新后仅客户端 state 中的气泡丢失。
 * 元数据以首行 HTML 注释编码，与 api-messages 解析共用。
 */
export type BlinoWfMetaV1 = {
  v: 1
  /** host=选中的表单行；done=成功结论；fail=失败 */
  k: 'h' | 'd' | 'f'
  wn: string
  i?: string
  r?: string
  /** 与上一条 assistant 不合并为一条（mergeConsecutiveAssistantRows） */
  nm: true
}

const BLINO_WF_LEAD = /^<!--\s*blino-wf:([\s\S]*?)-->\s*\n?/

export function withBlinoWfPrefix(visible: string, meta: BlinoWfMetaV1): string {
  return `<!-- blino-wf:${JSON.stringify(meta)}-->\n${visible}`
}

export function parseBlinoWfFromAssistantString(content: string): {
  content: string
  meta?: BlinoWfMetaV1
  noMerge: boolean
} {
  const m = content.match(BLINO_WF_LEAD)
  if (!m) return { content, noMerge: false }
  try {
    const meta = JSON.parse(m[1]!) as BlinoWfMetaV1
    if (meta?.v !== 1 || !meta.k) {
      return { content: content.replace(BLINO_WF_LEAD, '').trimStart(), noMerge: false }
    }
    return {
      content: content.slice(m[0]!.length),
      meta,
      noMerge: meta.nm === true,
    }
  } catch {
    return { content: content.replace(BLINO_WF_LEAD, '').trimStart(), noMerge: false }
  }
}

export async function appendSessionUiMessage(
  blinoBaseUrl: string,
  sessionId: string | null | undefined,
  message: { role: 'user' | 'assistant'; content: string },
): Promise<void> {
  if (!sessionId) return
  try {
    const res = await fetch(
      `${blinoBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/ui-message`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      },
    )
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn('[ui-message]', res.status, await res.text().catch(() => ''))
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[ui-message] failed', e)
  }
}
