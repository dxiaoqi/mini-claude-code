/**
 * 进程内轻量事件总线（单例）
 * 用于 HIL 暂停 / 恢复等解耦信令，无外部依赖。
 */

type Payload = { id: string; [k: string]: unknown }

type Handler = (payload: Payload) => void

type Waiter = {
  eventType: string
  matchId: string
  resolve: (payload: Payload) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

class EventBus {
  private readonly listeners = new Map<string, Set<Handler>>()
  private readonly waiters: Waiter[] = []

  emit(eventType: string, payload: Payload): void {
    const handlers = this.listeners.get(eventType)
    if (handlers) {
      for (const h of handlers) {
        try {
          h(payload)
        } catch {
          // ignore handler errors; waiters should still run
        }
      }
    }

    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i]
      if (w.eventType === eventType && w.matchId === payload.id) {
        this.waiters.splice(i, 1)
        if (w.timer) clearTimeout(w.timer)
        w.resolve(payload)
      }
    }
  }

  on(eventType: string, handler: Handler): void {
    let set = this.listeners.get(eventType)
    if (!set) {
      set = new Set()
      this.listeners.set(eventType, set)
    }
    set.add(handler)
  }

  off(eventType: string, handler: Handler): void {
    const set = this.listeners.get(eventType)
    if (!set) return
    set.delete(handler)
    if (set.size === 0) this.listeners.delete(eventType)
  }

  /**
   * 在收到匹配 `eventType` 且 `payload.id === matchId` 的 emit 时 resolve；可选超时后 reject。
   * `timeoutMs` 缺省或 <= 0 表示不超时（一直 pending 直到匹配事件）。
   */
  waitFor(eventType: string, matchId: string, timeoutMs?: number): Promise<Payload> {
    return new Promise<Payload>((resolve, reject) => {
      const waiter: Waiter = {
        eventType,
        matchId,
        resolve,
        reject,
        timer: undefined,
      }
      this.waiters.push(waiter)
      if (timeoutMs !== undefined && timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const idx = this.waiters.indexOf(waiter)
          if (idx >= 0) this.waiters.splice(idx, 1)
          reject(new Error(`waitFor('${eventType}', '${matchId}') timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }
    })
  }
}

export const eventBus = new EventBus()
