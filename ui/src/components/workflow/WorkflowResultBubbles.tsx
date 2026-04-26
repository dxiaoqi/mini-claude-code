'use client'

export function WorkflowCompleteBubble({ status = 'done' }: { status?: 'done' | 'failed' }) {
  if (status === 'failed') {
    return (
      <div style={{ maxWidth: 480, fontSize: 14, color: 'var(--text-secondary)' }}>Workflow 已结束（失败）</div>
    )
  }
  return (
    <div style={{ maxWidth: 480, fontSize: 14, color: 'var(--color-text-success, #16a34a)' }}>✓ Workflow 已完成</div>
  )
}

export function WorkflowErrorBubble({ nodeId, error }: { nodeId: string; error: string }) {
  return (
    <div style={{ maxWidth: 480, fontSize: 14, color: 'var(--color-text-danger, #ef4444)' }}>
      ✗ Workflow 在节点 {nodeId} 失败：{error}
    </div>
  )
}
