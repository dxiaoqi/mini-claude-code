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

export type PhaseForDiagram = { id: string; notes?: string; activateSkillPacks?: string[] }

/**
 * Mermaid with draw.io–like canvas (subtle grid), round nodes, link styling, and
 * post-render: native SVG &lt;title&gt; tooltips + active node highlight (no long labels on nodes).
 */
export function WorkflowMermaidDiagram({
  customSource,
  phases,
  activePhaseIndex,
  isAuto,
}: {
  customSource?: string | null
  phases: PhaseForDiagram[]
  activePhaseIndex: number
  /** True when definition is from buildPhasesFlowchartMermaid (we can add tooltips by node index). */
  isAuto: boolean
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
        const lightVars = {
          primaryColor: '#F0EEE6',
          primaryTextColor: '#3D3929',
          primaryBorderColor: 'rgba(61, 57, 41, 0.22)',
          lineColor: '#B4B2A7',
          secondaryColor: '#FAF9F5',
          tertiaryColor: '#FFFFFF',
        }
        const darkVars = {
          primaryColor: '#2A2928',
          primaryTextColor: '#F5F4EE',
          primaryBorderColor: 'rgba(245, 244, 238, 0.18)',
          lineColor: '#6E6C68',
          secondaryColor: '#1F1E1D',
          tertiaryColor: '#30302E',
        }
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: docTheme === 'light' ? lightVars : darkVars,
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            nodeSpacing: 52,
            rankSpacing: 48,
            curve: 'basis',
            padding: 12,
          },
        })
        const graphId = `wfgraph-${uid}`
        const { svg: svgString } = await mermaid.render(graphId, definition)
        if (cancelled || !el) return
        el.innerHTML = svgString
        setError(null)

        const svg = el.querySelector('svg')
        if (svg) {
          svg.setAttribute('role', 'img')
          if (isAuto && phases.length > 0) {
            const nodes = Array.from(svg.querySelectorAll<SVGGElement>('g.node'))
            nodes.forEach((g, i) => {
              g.classList.remove('wf-mermaid--active')
              if (i >= phases.length) return
              const p = phases[i]!
              const text = [p.id]
              if (p.notes) text.push(p.notes)
              if (p.activateSkillPacks?.length) text.push(`Packs: ${p.activateSkillPacks.join(', ')}`)
              if (i === activePhaseIndex) text.push('当前阶段')
              const t = g.querySelector('title')
              if (t) t.textContent = text.join('\n')
              else {
                const nt = document.createElementNS('http://www.w3.org/2000/svg', 'title')
                nt.textContent = text.join('\n')
                g.insertBefore(nt, g.firstChild)
              }
              if (i === activePhaseIndex) g.classList.add('wf-mermaid--active')
            })
          }
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
  }, [definition, uid, docTheme, phases, activePhaseIndex, isAuto])

  if (!definition) return null

  return (
    <div
      className="workflow-mermaid-canvas"
      style={{
        position: 'relative',
        borderRadius: 'var(--radius-md)',
        /* subtle grid, draw.io–like */
        backgroundColor: 'var(--bg-secondary)',
        backgroundImage: `
          linear-gradient(var(--border-default) 0.5px, transparent 0.5px),
          linear-gradient(90deg, var(--border-default) 0.5px, transparent 0.5px)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0',
        padding: 12,
      }}
    >
      <style>{`
        .workflow-mermaid-root { position: relative; }
        .workflow-mermaid-root svg {
          max-width: 100%;
          height: auto;
          display: block;
        }
        .workflow-mermaid-root g.wf-mermaid--active .nodeLabel { font-weight: 600; }
        .workflow-mermaid-root g.wf-mermaid--active .cluster rect { stroke: var(--accent) !important; }
        .workflow-mermaid-root .edgePath path { stroke-width: 1.75px !important; }
      `}</style>
      <div
        ref={containerRef}
        style={{
          overflow: 'auto',
          maxWidth: '100%',
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
