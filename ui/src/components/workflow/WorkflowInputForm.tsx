'use client'

import type { CSSProperties } from 'react'
import type { WorkflowInput } from '@/lib/types'

/** 与 WorkflowDAGCard 无参「启动」共用：同高、小尺寸、主题化主按钮（含暗色下可读） */
export const workflowFormActionRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 12,
}

const workflowFormBtnBase: CSSProperties = {
  minHeight: 30,
  height: 30,
  padding: '0 12px',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: 1,
  borderRadius: 'var(--radius-sm)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
}

export function workflowFormCancelButtonStyle(): CSSProperties {
  return {
    ...workflowFormBtnBase,
    border: '0.5px solid var(--border-default)',
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
  }
}

export function workflowFormPrimaryButtonStyle(submitting: boolean): CSSProperties {
  return {
    ...workflowFormBtnBase,
    border: '0.5px solid var(--border-default)',
    background: 'var(--info-bg)',
    color: 'var(--info)',
    cursor: submitting ? 'not-allowed' : 'pointer',
    opacity: submitting ? 0.75 : 1,
  }
}

export interface WorkflowInputFormProps {
  inputs: WorkflowInput[]
  values: Record<string, string>
  errors: Record<string, string>
  onChange: (id: string, value: string) => void
  onSubmit: () => void
  onCancel: () => void
  submitting: boolean
}

export function WorkflowInputForm({
  inputs,
  values,
  errors,
  onChange,
  onSubmit,
  onCancel,
  submitting,
}: WorkflowInputFormProps) {
  return (
    <div
      style={{
        border: '0.5px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: 10,
        background: 'var(--bg-tertiary)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>填写参数</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {inputs.map(inp => (
          <div key={inp.id}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 3 }}>{inp.label}</div>
            {inp.type === 'text' && (
              <input
                type="text"
                value={values[inp.id] ?? ''}
                onChange={e => onChange(inp.id, e.target.value)}
                placeholder={inp.placeholder}
                style={{
                  width: '100%',
                  height: 32,
                  boxSizing: 'border-box',
                  borderRadius: 'var(--radius-sm)',
                  border: '0.5px solid var(--border-default)',
                  padding: '0 10px',
                  fontSize: 13,
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                }}
              />
            )}
            {inp.type === 'textarea' && (
              <textarea
                value={values[inp.id] ?? ''}
                onChange={e => onChange(inp.id, e.target.value)}
                placeholder={inp.placeholder}
                rows={3}
                style={{
                  width: '100%',
                  height: 80,
                  boxSizing: 'border-box',
                  borderRadius: 'var(--radius-sm)',
                  border: '0.5px solid var(--border-default)',
                  padding: 8,
                  fontSize: 13,
                  resize: 'none',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                }}
              />
            )}
            {inp.type === 'select' && (
              <select
                value={values[inp.id] ?? ''}
                onChange={e => onChange(inp.id, e.target.value)}
                style={{
                  width: '100%',
                  height: 32,
                  borderRadius: 'var(--radius-sm)',
                  border: '0.5px solid var(--border-default)',
                  padding: '0 8px',
                  fontSize: 13,
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="">选择…</option>
                {(inp.options ?? []).map(opt => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
            {inp.type === 'date' && (
              <input
                type="date"
                value={values[inp.id] ?? ''}
                onChange={e => onChange(inp.id, e.target.value)}
                style={{
                  width: '100%',
                  height: 32,
                  boxSizing: 'border-box',
                  borderRadius: 'var(--radius-sm)',
                  border: '0.5px solid var(--border-default)',
                  padding: '0 10px',
                  fontSize: 13,
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                }}
              />
            )}
            {errors[inp.id] && (
              <div style={{ fontSize: 12, color: '#A32D2D', marginTop: 4 }}>{errors[inp.id]}</div>
            )}
          </div>
        ))}
      </div>
      <div style={workflowFormActionRowStyle}>
        <button type="button" onClick={onCancel} style={workflowFormCancelButtonStyle()}>
          取消
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={onSubmit}
          style={workflowFormPrimaryButtonStyle(submitting)}
        >
          {submitting ? '启动中…' : '启动'}
        </button>
      </div>
    </div>
  )
}
