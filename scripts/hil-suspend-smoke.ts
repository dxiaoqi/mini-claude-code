/**
 * 验收：不连 LLM 时验证 HIL 挂起 / 恢复时序
 *
 * 运行: npx tsx scripts/hil-suspend-smoke.ts
 *
 * 预期输出顺序：
 *   1) [smoke] emit hil_suspend, hilPending=true
 *   2) [smoke] after 0ms: loop would block (simulated) …
 *   3) 5s 后 emit hil_resume
 *   4) [smoke] waitFor(hil_resume) resolved
 *   5) [hil] resumed <sessionId>（或自定义日志）
 */
import { createSessionState } from '../src/state/SessionState.js'
import { eventBus } from '../src/events/EventBus.js'
import type { SessionState } from '../src/types.js'

function log(line: string) {
  // eslint-disable-next-line no-console
  console.log(line)
}

async function simulateBlockBeforeNextModelTurn(state: SessionState) {
  if (!state.hilPending) {
    return
  }
  const id = state.sessionId
  log(`[hil] suspended ${id} (smoke: waiting for hil_resume)`)
  await eventBus.waitFor('hil_resume', id)
  state.hilPending = false
  log(`[hil] resumed ${id}`)
}

async function main() {
  const state = createSessionState({ cwd: process.cwd(), settings: {} })
  state.hilPending = true
  log(`[smoke] sessionId=${state.sessionId}`)
  eventBus.emit('hil_suspend', { id: state.sessionId })
  log('[smoke] emit hil_suspend → next model turn 被挂起（模拟）…')

  const resume = new Promise<void>(resolve => {
    setTimeout(() => {
      log('[smoke] (5s) emit hil_resume')
      eventBus.emit('hil_resume', { id: state.sessionId })
      resolve()
    }, 5_000)
  })

  const wait = simulateBlockBeforeNextModelTurn(state)
  await Promise.all([wait, resume])
  log('[smoke] done')
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
