'use client'

import { useState } from 'react'
import { Terminal, Layers } from 'lucide-react'

export type AppMode = 'agent' | 'artifacts'

const MODES: AppMode[] = ['agent', 'artifacts']

const MODE_META: Record<AppMode, { label: string; icon: React.ReactNode; title: string }> = {
  agent: {
    label: 'Agent',
    icon: <Terminal width={11} height={11} />,
    title: 'Agent 模式 — 工具调用 + 代码执行',
  },
  artifacts: {
    label: 'Artifacts',
    icon: <Layers width={11} height={11} />,
    title: 'Artifacts 模式 — Agent 工具调用 + 可视化内容渲染',
  },
}

interface Props {
  mode: AppMode
  onChange: (mode: AppMode) => void
  disabled?: boolean
}

export function ModeToggle({ mode, onChange, disabled }: Props) {
  const [hov, setHov] = useState(false)

  const toggle = () => {
    if (disabled) return
    const idx = MODES.indexOf(mode)
    onChange(MODES[(idx + 1) % MODES.length])
  }

  const meta = MODE_META[mode]
  const isAgent = mode === 'agent'

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={meta.title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 9px',
        height: 30,
        borderRadius: 'var(--radius-md)',
        border: `0.5px solid ${hov && !disabled ? 'var(--border-hover)' : 'var(--border-default)'}`,
        background: hov && !disabled ? 'var(--bg-secondary)' : 'transparent',
        color: isAgent ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: '11.5px',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 150ms ease',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
      }}
    >
      {meta.icon}
      <span>{meta.label}</span>
    </button>
  )
}
