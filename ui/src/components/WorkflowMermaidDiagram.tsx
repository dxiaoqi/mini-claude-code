'use client'

import { useEffect, useId, useRef, useState, useMemo } from 'react'
import { buildPhasesFlowchartMermaid, isReasonableMermaidSource } from '@/lib/workflow-mermaid'

function useDocumentTheme(): 'light' | 'dark' {
  const [t, setT] = useState<'light' | 'dark'>(() =>
    (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light')
      ? 'light'
      : 'dark',
  )
  useEffect(() => {
    const el = document.documentElement
    const sync = () => {
      setT(el.getAttribute('data-theme') === 'light' ? 'light' : 'dark')
    }
    const obs = new MutationObserver(sync)
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return t
}

type PhaseLite = { id: string }

/**
 * Renders workflow as Mermaid: uses `customSource` from workflow.json when set and valid,
 * otherwise a simple LR flowchart from `phases` with the active step prefixed with ▶.
 */
export function WorkflowMermaidDiagram({
  customSource,
  phases,
  activePhaseIndex,
}: {
  customSource?: string | null
  phases: PhaseLite[]
  activePhaseIndex: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const uid = useId().replace(/:/g, '')
  const [error, setError] = useState<string | null>(null)
  const docTheme = useDocumentTheme()

  const definition = useMemo(() => {
    if (customSource && isReasonableMermaidSource(customSource)) {
      return customSource.trim()
    }
    if (phases.length > 0) {
      return buildPhasesFlowchartMermaid(phases, activePhaseIndex)
    }
    return ''
  }, [customSource, phases, activePhaseIndex])

  useEffect(() => {
    if (!definition || !containerRef.current) return
    let cancelled = false
    const el = containerRef.current

    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        // Align Mermaid with globals.css (terracotta accent, paper backgrounds)
        const lightVars = {
          primaryColor: '#F5E9E2',
          primaryTextColor: '#3D3929',
          primaryBorderColor: '#C96442',
          lineColor: '#B4B2A7',
          secondaryColor: '#F0EEE6',
          tertiaryColor: '#FAF9F5',
        }
        const darkVars = {
          primaryColor: '#3D2A22',
          primaryTextColor: '#F5F4EE',
          primaryBorderColor: '#D97757',
          lineColor: '#83827D',
          secondaryColor: '#1F1E1D',
          tertiaryColor: '#262624',
        }
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: docTheme === 'light' ? lightVars : darkVars,
        })
        const graphId = `wfgraph-${uid}`
        const { svg } = await mermaid.render(graphId, definition)
        if (!cancelled && el) {
          el.innerHTML = svg
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          el.innerHTML = ''
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [definition, uid, docTheme])

  if (!definition) return null

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <style>{`
        .workflow-mermaid-root svg { max-width: 100%; height: auto; display: block; }
      `}</style>
      <div
        ref={containerRef}
        style={{
          overflow: 'auto',
          maxWidth: '100%',
          fontSize: 12,
        }}
        className="workflow-mermaid-root"
      />
      {error && (
        <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--text-secondary)' }}>
          流程图解析：{error}
        </p>
      )}
    </div>
  )
}
