/**
 * Report Generator — 生成 HTML + Markdown 报告
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { TestSuiteResult, EvalResult } from './types.js'

export async function generateReport(suite: TestSuiteResult, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  await generateMarkdownReport(suite, outputDir)
  await generateHTMLReport(suite, outputDir)
}

async function generateMarkdownReport(suite: TestSuiteResult, dir: string): Promise<void> {
  const lines: string[] = [
    `# Evaluation Report`,
    ``,
    `**Run at:** ${suite.runAt}  `,
    `**Total:** ${suite.passedCases}/${suite.totalCases} passed (${Math.round(suite.passRate * 100)}%)`,
    ``,
    `## GRAPE Score`,
    ``,
    `| Dimension | Score | Description |`,
    `|-----------|-------|-------------|`,
    `| G Goal | **${suite.grapeAverage.goal}/100** | Intent alignment |`,
    `| R Reasoning | **${suite.grapeAverage.reasoning}/100** | Planning quality |`,
    `| A Action | **${suite.grapeAverage.action}/100** | Tool efficiency |`,
    `| P Proof | **${suite.grapeAverage.proof}/100** | Self-verification |`,
    `| E Expression | **${suite.grapeAverage.expression}/100** | Communication |`,
    `| **Composite** | **${suite.grapeAverage.composite}/100** | Weighted total |`,
    ``,
    `## By Level`,
    ``,
    `| Level | Passed | Avg Score | Avg Turns | Avg Duration |`,
    `|-------|--------|-----------|-----------|--------------|`,
    ...(['S', 'M', 'L'] as const).map(l => {
      const s = suite.byLevel[l]
      return `| ${l} | ${s.passed}/${s.total} | ${s.avgCompositeScore}/100 | ${s.avgTurns} | ${Math.round(s.avgDurationMs / 1000)}s |`
    }),
    ``,
    `## By Category`,
    ``,
    `| Category | Passed | Avg Score | Top Failure Pattern |`,
    `|----------|--------|-----------|---------------------|`,
    ...Object.entries(suite.byCategory).map(([cat, s]) =>
      `| ${cat} | ${s.passed}/${s.total} | ${s.avgCompositeScore}/100 | ${(s.topFailurePatterns[0] || 'N/A').slice(0, 60)} |`
    ),
    ``,
    `## Detailed Results`,
    ``,
    ...suite.results.map(r => formatResultMd(r)),
  ]

  await writeFile(resolve(dir, 'report.md'), lines.join('\n'), 'utf-8')
}

function formatResultMd(r: EvalResult): string {
  const icon = r.functionalPass ? '✅' : '❌'
  const lines = [
    `### ${icon} ${r.testCase.id} — ${r.testCase.title}`,
    ``,
    `**Level:** ${r.testCase.level} | **Category:** ${r.testCase.category} | **Composite:** ${r.grape.composite}/100`,
    `**Turns:** ${r.trace.turnCount} | **Tools called:** ${r.trace.toolCalls.length} | **Cost:** $${r.trace.totalCostUSD.toFixed(4)}`,
    ``,
    `**GRAPE:** G:${r.grape.goal} R:${r.grape.reasoning} A:${r.grape.action} P:${r.grape.proof} E:${r.grape.expression}`,
    ``,
  ]

  if (!r.functionalPass && r.firstFailure) {
    lines.push(`**First failure:** ${r.firstFailure}`)
    lines.push(``)
  }

  if (r.error) {
    lines.push(`**Framework error:** ${r.error}`)
    lines.push(``)
  }

  // Validator summary
  const failed = r.validatorResults.filter(vr => !vr.result.passed)
  if (failed.length > 0) {
    lines.push(`**Failed validators:**`)
    failed.slice(0, 3).forEach(vr => {
      lines.push(`- ${vr.result.message}`)
    })
    lines.push(``)
  }

  return lines.join('\n')
}

async function generateHTMLReport(suite: TestSuiteResult, dir: string): Promise<void> {
  const scoreColor = (s: number) =>
    s >= 80 ? '#22c55e' : s >= 60 ? '#eab308' : '#ef4444'

  const resultRows = suite.results.map(r => `
    <tr class="${r.functionalPass ? 'pass' : 'fail'}">
      <td>${r.functionalPass ? '✅' : '❌'}</td>
      <td><code>${r.testCase.id}</code></td>
      <td>${r.testCase.level}</td>
      <td>${r.testCase.category}</td>
      <td style="color:${scoreColor(r.grape.composite)};font-weight:bold">${r.grape.composite}</td>
      <td>${r.grape.goal}</td>
      <td>${r.grape.reasoning}</td>
      <td>${r.grape.action}</td>
      <td>${r.grape.proof}</td>
      <td>${r.grape.expression}</td>
      <td>${r.trace.turnCount}</td>
      <td>$${r.trace.totalCostUSD.toFixed(4)}</td>
      <td class="failure-msg">${r.firstFailure ? r.firstFailure.slice(0, 80) : '-'}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Eval Report — ${suite.runAt.slice(0, 10)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f0f0f; color: #e1e1e1; }
    h1 { color: #60a5fa; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
    .card { background: #1c1c1c; border: 1px solid #2a2a2a; border-radius: 8px; padding: 1rem; }
    .card .label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
    .card .value { font-size: 1.8rem; font-weight: bold; margin-top: 0.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { background: #1a1a2e; color: #60a5fa; padding: 0.6rem 0.5rem; text-align: left; position: sticky; top: 0; }
    td { padding: 0.4rem 0.5rem; border-bottom: 1px solid #1e1e1e; }
    tr.pass { background: #0d1f0d; }
    tr.fail { background: #1f0d0d; }
    tr:hover { opacity: 0.85; }
    .failure-msg { color: #f87171; font-size: 0.75rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .grape-bar { display: flex; gap: 4px; margin: 0.5rem 0; }
    .grape-dim { text-align: center; font-size: 0.7rem; }
    .bar { height: 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>🧪 /lumi Evaluation</h1>
  <p style="color:#888">${suite.runAt} · ${suite.totalCases} cases</p>

  <div class="summary">
    <div class="card">
      <div class="label">Pass Rate</div>
      <div class="value" style="color:${scoreColor(Math.round(suite.passRate*100))}">${Math.round(suite.passRate * 100)}%</div>
      <div style="color:#888;font-size:0.8rem">${suite.passedCases}/${suite.totalCases} cases</div>
    </div>
    <div class="card">
      <div class="label">Composite Score</div>
      <div class="value" style="color:${scoreColor(suite.grapeAverage.composite)}">${suite.grapeAverage.composite}<span style="font-size:1rem">/100</span></div>
    </div>
    <div class="card">
      <div class="label">GRAPE Breakdown</div>
      ${['G','R','A','P','E'].map((d, i) => {
        const vals = [suite.grapeAverage.goal, suite.grapeAverage.reasoning, suite.grapeAverage.action, suite.grapeAverage.proof, suite.grapeAverage.expression]
        return `<div class="grape-dim">${d}<div class="bar" style="width:${vals[i]}%;background:${scoreColor(vals[i])}"></div>${vals[i]}</div>`
      }).join('')}
    </div>
    ${(['S','M','L'] as const).map(l => {
      const s = suite.byLevel[l]
      return `<div class="card">
        <div class="label">Level ${l}</div>
        <div class="value">${s.passed}/${s.total}</div>
        <div style="color:#888;font-size:0.8rem">avg ${s.avgCompositeScore}/100</div>
      </div>`
    }).join('')}
  </div>

  <h2>Results</h2>
  <table>
    <thead>
      <tr>
        <th></th><th>ID</th><th>L</th><th>Category</th>
        <th>Score</th><th>G</th><th>R</th><th>A</th><th>P</th><th>E</th>
        <th>Turns</th><th>Cost</th><th>Failure</th>
      </tr>
    </thead>
    <tbody>${resultRows}</tbody>
  </table>
</body>
</html>`

  await writeFile(resolve(dir, 'report.html'), html, 'utf-8')
}
