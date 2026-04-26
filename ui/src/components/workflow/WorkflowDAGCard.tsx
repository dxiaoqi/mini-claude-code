'use client'

import { Fragment, useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { topologicalNodeIds } from '@/lib/workflow-topo'
import type { NodeState, DagCardState, WorkflowSummary, HILState } from '@/lib/types'
import { WorkflowInputForm, workflowFormPrimaryButtonStyle } from './WorkflowInputForm'

const STATUS_LABEL: Record<NodeState['status'], string> = {
  pending: '待执行',
  running: '执行中',
  done: '完成',
  failed: '失败',
  waiting: '等待确认',
}

function optionDecision(opt: { id: string; label: string }, index: number): 'approve' | 'reject' {
  if (opt.id === 'approve' || opt.id === 'reject') return opt.id
  return index === 0 ? 'approve' : 'reject'
}

function nodeBoxStyle(s: NodeState['status']): CSSProperties {
  switch (s) {
    case 'pending':
      return { background: '#F1EFE8', border: '1px solid #B4B2A9', color: '#5F5E5A' }
    case 'running':
      return { background: '#E6F1FB', border: '1px solid #85B7EB', color: '#185FA5' }
    case 'done':
      return { background: '#EAF3DE', border: '1px solid #97C459', color: '#3B6D11' }
    case 'failed':
      return { background: '#FCEBEB', border: '1px solid #F09595', color: '#A32D2D' }
    case 'waiting':
      return { background: '#FAEEDA', border: '1px solid #EF9F27', color: '#854F0B' }
    default:
      return { background: '#f5f5f5', border: '1px solid #ccc' }
  }
}

function StatusIcon({ status }: { status: NodeState['status'] }) {
  if (status === 'pending') {
    return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9ca3af', flexShrink: 0 }} />
  }
  if (status === 'running') {
    return (
      <span
        style={{
          width: 14,
          height: 14,
          border: '2px solid #85B7EB',
          borderTopColor: '#185FA5',
          borderRadius: '50%',
          display: 'inline-block',
          animation: 'wf-spin 0.8s linear infinite',
          flexShrink: 0,
        }}
      />
    )
  }
  if (status === 'done') {
    return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B6D11', flexShrink: 0 }} />
  }
  if (status === 'failed') {
    return <span style={{ color: '#A32D2D', fontSize: 14, lineHeight: 1, fontWeight: 600 }}>×</span>
  }
  if (status === 'waiting') {
    return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF9F27', flexShrink: 0 }} />
  }
  return null
}

function NodeTextBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.split('\n').length > 2 || text.length > 100
  return (
    <div style={{ marginTop: 6 }}>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          display: open ? 'block' : '-webkit-box',
          WebkitLineClamp: open ? (undefined as unknown as number) : 2,
          WebkitBoxOrient: 'vertical' as const,
          overflow: open ? 'visible' : 'hidden',
        }}
      >
        {text}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            marginTop: 2,
            fontSize: 11,
            color: 'inherit',
            opacity: 0.85,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          {open ? '收起' : '展开'}
        </button>
      )}
    </div>
  )
}

function ArrowConn() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        flex: '0 0 24px',
        color: 'var(--text-tertiary)',
      }}
      aria-hidden
    >
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
        <path
          d="M0 5h10l-2-2M10 5l-2 2"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

/** 顶栏工作流链：节点名之间用小箭头，与 DAG 中 ArrowConn 线宽一致 */
function HeaderChainArrow() {
  return (
    <span
      style={{ display: 'inline-flex', flex: '0 0 auto', color: 'var(--text-tertiary)' }}
      aria-hidden
    >
      <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
        <path
          d="M0 5H5.5l-1-1.5M5.5 5L4.5 6.5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export interface WorkflowDAGCardProps {
  /** 贴在输入区上方时略收紧布局、顶宽撑满父容器 */
  docked?: boolean
  workflow: WorkflowSummary
  dagState: DagCardState | null
  formValues: Record<string, string>
  formErrors: Record<string, string>
  formSubmitting: boolean
  onFormChange: (id: string, value: string) => void
  onFormSubmit: () => void
  onFormCancel: () => void
  onHILDecide: (nodeId: string, decision: 'approve' | 'reject') => void
  /** 项目侧只读：仅展示 DAG，不在此 HIL（审批走 toast） */
  readOnly?: boolean
}

export function WorkflowDAGCard({
  docked = false,
  workflow,
  dagState,
  formValues,
  formErrors,
  formSubmitting,
  onFormChange,
  onFormSubmit,
  onFormCancel,
  onHILDecide,
  readOnly = false,
}: WorkflowDAGCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const inputs = workflow.inputs ?? []
  const graphNodes = workflow.nodes?.length
    ? workflow.nodes
    : (workflow.nodeIds ?? []).map(id => ({ id, dependsOn: [] as string[] }))

  const order = useMemo(() => {
    const t = graphNodes.length > 0 ? topologicalNodeIds(graphNodes) : []
    if (t.length > 0) return t
    if ((workflow.nodeIds?.length ?? 0) > 0) return workflow.nodeIds!
    return Object.keys(dagState?.nodeStates ?? {})
  }, [graphNodes, workflow.nodeIds, dagState?.nodeStates])

  const headerChain = useMemo(
    () => (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 3,
          minWidth: 0,
          maxWidth: '100%',
        }}
        title={order.join(' → ')}
      >
        {order.map((id, i) => (
          <Fragment key={`${id}-${i}`}>
            {i > 0 && <HeaderChainArrow />}
            <span
              style={{
                fontSize: docked ? 10 : 11,
                color: 'var(--text-tertiary)',
                maxWidth: docked ? 64 : 88,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexShrink: 1,
              }}
            >
              {id}
            </span>
          </Fragment>
        ))}
      </div>
    ),
    [order, docked],
  )
  const nodeStates = dagState?.nodeStates ?? {}
  const hilState = dagState?.hilState
  const anyNodeFailed = Object.values(nodeStates).some(n => n.status === 'failed')
  /** 终态 SSE 竞态时 overall 可能未写入 failed，用节点级失败驱动头标 */
  const effectiveOverall: 'running' | 'done' | 'failed' | undefined =
    dagState == null
      ? undefined
      : dagState.overallStatus === 'failed' || anyNodeFailed
        ? 'failed'
        : dagState.overallStatus

  const headerBadge = (() => {
    if (dagState === null) {
      return (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 99,
            background: 'var(--bg-secondary)',
            color: 'var(--text-tertiary)',
            border: '0.5px solid var(--border-default)',
          }}
        >
          填写参数
        </span>
      )
    }
    if (effectiveOverall === 'done') {
      return (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 99,
            background: '#EAF3DE',
            color: '#3B6D11',
            border: '1px solid #97C459',
          }}
        >
          已完成
        </span>
      )
    }
    if (effectiveOverall === 'failed') {
      return (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 99,
            background: '#FCEBEB',
            color: '#A32D2D',
            border: '1px solid #F09595',
          }}
        >
          已失败
        </span>
      )
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 99,
            background: '#E6F1FB',
            color: '#185FA5',
            border: '1px solid #85B7EB',
          }}
        >
          运行中
        </span>
        <span
          style={{
            width: 12,
            height: 12,
            border: '2px solid #85B7EB',
            borderTopColor: '#185FA5',
            borderRadius: '50%',
            display: 'inline-block',
            animation: 'wf-spin 0.8s linear infinite',
          }}
        />
      </span>
    )
  })()

  const showHil =
    !readOnly &&
    dagState &&
    hilState &&
    dagState.overallStatus === 'running' &&
    (hilState as HILState).nodeId
  const formPhase = dagState === null

  return (
    <div
      style={{
        maxWidth: docked ? '100%' : 720,
        borderRadius: 'var(--radius-lg)',
        border: '0.5px solid var(--border-default)',
        background: 'var(--bg-primary)',
        overflow: 'hidden',
        marginBottom: docked ? 0 : 16,
      }}
    >
      <style>
        {`@keyframes wf-spin { to { transform: rotate(360deg); } }`}
      </style>
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: docked ? 8 : 12,
          padding: docked ? '8px 10px' : '12px 14px',
          background: 'var(--bg-secondary)',
          border: 'none',
          borderBottom: collapsed ? 'none' : '0.5px solid var(--border-default)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: docked ? 6 : 8, minWidth: 0 }}>
          <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--text-tertiary)' }}>
            {collapsed ? (
              <ChevronRight size={docked ? 12 : 13} strokeWidth={2.25} absoluteStrokeWidth />
            ) : (
              <ChevronDown size={docked ? 12 : 13} strokeWidth={2.25} absoluteStrokeWidth />
            )}
          </span>
          <span style={{ fontSize: docked ? 13 : 14, fontWeight: 500, color: 'var(--text-primary)' }}>{workflow.name}</span>
          {headerBadge}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 1,
            minWidth: 0,
            maxWidth: '45%',
            justifyContent: 'flex-end',
          }}
        >
          {headerChain}
        </div>
      </button>
      {!collapsed && (
        <>
          {dagState?.globalError && (
            <div
              style={{
                margin: docked ? '0 10px 6px' : '0 14px 8px',
                padding: '8px 10px',
                fontSize: 13,
                color: '#A32D2D',
                background: '#FCEBEB',
                border: '1px solid #F09595',
                borderRadius: 8,
              }}
            >
              {dagState.globalError}
            </div>
          )}
          <div style={{ padding: docked ? '8px 10px' : '12px 14px' }}>
            {formPhase && !readOnly && inputs.length > 0 && (
              <WorkflowInputForm
                inputs={inputs}
                values={formValues}
                errors={formErrors}
                onChange={onFormChange}
                onSubmit={onFormSubmit}
                onCancel={onFormCancel}
                submitting={formSubmitting}
              />
            )}
            {formPhase && !readOnly && inputs.length === 0 && (
              <div style={{ padding: 8, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={onFormSubmit}
                  disabled={formSubmitting}
                  style={workflowFormPrimaryButtonStyle(formSubmitting)}
                >
                  {formSubmitting ? '启动中…' : '启动'}
                </button>
              </div>
            )}

            {dagState !== null && (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    gap: 0,
                  }}
                >
                  {order.map((id, i) => {
                    const st = nodeStates[id] ?? { status: 'pending' as const }
                    const style = nodeBoxStyle(st.status)
                    return (
                      <Fragment key={id}>
                        {i > 0 && <ArrowConn />}
                        <div
                          style={{
                            ...style,
                            borderRadius: 8,
                            padding: '10px 8px 8px',
                            minWidth: 110,
                            maxWidth: 160,
                            flex: '0 0 auto',
                            boxSizing: 'border-box',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <div style={{ paddingTop: 2 }}>
                              <StatusIcon status={st.status} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, wordBreak: 'break-all' }}>{id}</div>
                              <div style={{ fontSize: 10, opacity: 0.9 }}>
                                {st.status === 'waiting' ? '等待审批' : STATUS_LABEL[st.status]}
                              </div>
                              {st.status === 'done' && st.result != null && <NodeTextBlock text={st.result} />}
                              {st.status === 'failed' && st.error && <NodeTextBlock text={st.error} />}
                            </div>
                          </div>
                        </div>
                      </Fragment>
                    )
                  })}
                </div>

                {showHil && hilState && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: '10px 12px',
                      borderRadius: 8,
                      /* 固定浅底确认区；勿用 var(--text-*) 作字色，暗色主题下为浅色会叠在暖黄底上不可读 */
                      background: '#FAEEDA',
                      border: '1px solid #EF9F27',
                      // @see --hil-warm-* 同系：在浅色面板上用深棕/绿保证对比度
                      color: '#633806',
                    }}
                  >
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: '#854F0B' }}>需要确认</span>
                    </div>
                    <p
                      style={{
                        fontSize: 13,
                        color: '#633806',
                        margin: '0 0 10px',
                        lineHeight: 1.5,
                      }}
                    >
                      {hilState.question}
                    </p>
                    {!hilState.decided && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {hilState.options.map((opt, idx) => {
                          const d = optionDecision(opt, idx)
                          const isApp = d === 'approve'
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => onHILDecide(hilState.nodeId, d)}
                              style={{
                                padding: '8px 16px',
                                fontSize: 13,
                                borderRadius: 8,
                                border: isApp ? '1px solid #97C459' : '1px solid #B4B2A9',
                                background: isApp ? 'rgba(151, 196, 89, 0.2)' : 'rgba(255, 255, 255, 0.5)',
                                color: isApp ? '#2d5a0a' : '#4a2f18',
                                cursor: 'pointer',
                              }}
                            >
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {hilState.decided && (
                      <>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6, opacity: 0.7 }}>
                          {hilState.options.map((opt, idx) => {
                            const d = optionDecision(opt, idx)
                            const isApp = d === 'approve'
                            const picked = hilState.decision === d
                            return (
                              <span
                                key={opt.id}
                                style={{
                                  padding: '6px 12px',
                                  fontSize: 12,
                                  borderRadius: 8,
                                  border: picked ? (isApp ? '1px solid #97C459' : '1px solid #B4B2A9') : '1px solid transparent',
                                  background: picked && isApp ? 'rgba(151, 196, 89, 0.25)' : 'transparent',
                                  color: '#6a5238',
                                }}
                              >
                                {opt.label}
                              </span>
                            )
                          })}
                        </div>
                        <p style={{ fontSize: 12, color: '#7a6448', margin: 0 }}>
                          已于 {hilState.decidedAt ?? '—'} 确认
                        </p>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
