/**
 * Evaluation Entry Point
 *
 * Usage:
 *   npx tsx tests/eval/run.ts                    # 全部用例
 *   npx tsx tests/eval/run.ts --level S           # 只跑 S 级
 *   npx tsx tests/eval/run.ts --level M,L         # 跑 M 和 L 级
 *   npx tsx tests/eval/run.ts --category research # 只跑 research 用例
 *   npx tsx tests/eval/run.ts --id S-intent-01    # 跑指定用例
 *   npx tsx tests/eval/run.ts --no-llm            # 关闭 LLM Judge（省成本）
 *   npx tsx tests/eval/run.ts --verbose           # 保留沙箱目录
 */

import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import chalk from 'chalk'
import { EvalRunner } from './framework/runner.js'
import { generateReport } from './framework/reporter.js'
import { smallCases } from './cases/small/index.js'
import { mediumCases } from './cases/medium/index.js'
import { largeCases } from './cases/large/index.js'
import type { EvalConfig, EvalResult, TestSuiteResult, TaskLevel, TaskCategory } from './framework/types.js'

// ─── CLI 参数解析 ────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const getArg = (name: string) => {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 ? args[idx + 1] : undefined
}
const hasFlag = (name: string) => args.includes(`--${name}`)

const levelFilter = getArg('level')?.split(',') as TaskLevel[] | undefined
const categoryFilter = getArg('category')?.split(',') as TaskCategory[] | undefined
const idFilter = getArg('id')?.split(',')
const noLlm = hasFlag('no-llm')
const verbose = hasFlag('verbose')
const parallel = parseInt(getArg('parallel') || '1', 10)

// ─── Config ──────────────────────────────────────────────────────────────────

const config: EvalConfig = {
  apiKey: process.env['ANTHROPIC_API_KEY'] || process.env['OPENAI_API_KEY'] || '',
  baseUrl: process.env['ANTHROPIC_BASE_URL'] || process.env['OPENAI_BASE_URL'],
  model: process.env['EVAL_MODEL'] || 'claude-sonnet-4-20250514',
  provider: process.env['ANTHROPIC_API_KEY'] ? 'anthropic' : 'openai',
  parallel,
  outputDir: resolve(process.cwd(), 'tests/eval/reports', new Date().toISOString().replace(/:/g, '-').slice(0, 19)),
  llmJudgeEnabled: !noLlm,
  verbose,
  filter: {
    levels: levelFilter,
    categories: categoryFilter,
    ids: idFilter,
  },
}

if (!config.apiKey) {
  console.error(chalk.red('Error: ANTHROPIC_API_KEY or OPENAI_API_KEY required'))
  process.exit(1)
}

// ─── Case Selection ───────────────────────────────────────────────────────────

let allCases = [...smallCases, ...mediumCases, ...largeCases]

if (config.filter?.levels?.length) {
  allCases = allCases.filter(c => config.filter!.levels!.includes(c.level))
}
if (config.filter?.categories?.length) {
  allCases = allCases.filter(c => config.filter!.categories!.includes(c.category))
}
if (config.filter?.ids?.length) {
  allCases = allCases.filter(c => config.filter!.ids!.includes(c.id))
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(config.outputDir, { recursive: true })

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════╗'))
  console.log(chalk.bold.cyan('║    /blino Evaluation Suite      ║'))
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════╝'))
  console.log(chalk.dim(`Model: ${config.model} | Cases: ${allCases.length} | LLM Judge: ${config.llmJudgeEnabled ? 'on' : 'off (--no-llm)'}`))
  console.log(chalk.dim(`Output: ${config.outputDir}\n`))

  const runner = new EvalRunner(config)
  const results: EvalResult[] = []
  let passed = 0
  let failed = 0

  // Progress display
  runner.on('case:start', ({ id }: { id: string }) => {
    process.stdout.write(chalk.dim(`  ⏳ ${id.padEnd(35)}`))
  })

  runner.on('case:end', ({ id, passed: p, composite }: { id: string; passed: boolean; composite: number }) => {
    const icon = p ? chalk.green('✓') : chalk.red('✗')
    const score = composite >= 80 ? chalk.green(`${composite}`) :
                  composite >= 60 ? chalk.yellow(`${composite}`) :
                  chalk.red(`${composite}`)
    process.stdout.write(`\r  ${icon} ${id.padEnd(35)} ${score}/100\n`)
    if (p) passed++ ; else failed++
  })

  runner.on('case:error', ({ id, error }: { id: string; error: string }) => {
    process.stdout.write(`\r  ${chalk.red('✗')} ${id.padEnd(35)} ${chalk.red('ERROR')}\n`)
    console.error(chalk.dim(`    ${error.slice(0, 100)}`))
    failed++
  })

  // Run cases (parallel or sequential)
  if (parallel > 1) {
    const chunks: typeof allCases[] = []
    for (let i = 0; i < allCases.length; i += parallel) {
      chunks.push(allCases.slice(i, i + parallel))
    }
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(chunk.map(tc => runner.runCase(tc)))
      results.push(...chunkResults)
    }
  } else {
    for (const tc of allCases) {
      const result = await runner.runCase(tc)
      results.push(result)
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────

  const passRate = results.length > 0 ? passed / results.length : 0

  console.log(chalk.bold('\n══════════════════════════════════════════════'))
  console.log(chalk.bold('Results Summary'))
  console.log('══════════════════════════════════════════════')

  // By level
  for (const level of ['S', 'M', 'L'] as TaskLevel[]) {
    const levelResults = results.filter(r => r.testCase.level === level)
    if (levelResults.length === 0) continue
    const lPassed = levelResults.filter(r => r.functionalPass).length
    const avgComposite = levelResults.reduce((s, r) => s + r.grape.composite, 0) / levelResults.length
    console.log(`  Level ${level}: ${chalk.bold(lPassed + '/' + levelResults.length)} passed | avg score: ${formatScore(avgComposite)}`)
  }

  // By category
  const categories = [...new Set(results.map(r => r.testCase.category))]
  console.log()
  for (const cat of categories) {
    const catResults = results.filter(r => r.testCase.category === cat)
    const cPassed = catResults.filter(r => r.functionalPass).length
    const avgComposite = catResults.reduce((s, r) => s + r.grape.composite, 0) / catResults.length
    console.log(`  ${cat.padEnd(14)}: ${cPassed}/${catResults.length} | ${formatScore(avgComposite)}`)
  }

  // GRAPE averages
  const grapeAvg = {
    goal: avg(results.map(r => r.grape.goal)),
    reasoning: avg(results.map(r => r.grape.reasoning)),
    action: avg(results.map(r => r.grape.action)),
    proof: avg(results.map(r => r.grape.proof)),
    expression: avg(results.map(r => r.grape.expression)),
    composite: avg(results.map(r => r.grape.composite)),
  }

  console.log(chalk.bold('\nGRAPE Score Breakdown:'))
  console.log(`  G Goal       ${formatScore(grapeAvg.goal)}  (intent alignment)`)
  console.log(`  R Reasoning  ${formatScore(grapeAvg.reasoning)}  (planning quality)`)
  console.log(`  A Action     ${formatScore(grapeAvg.action)}  (tool efficiency)`)
  console.log(`  P Proof      ${formatScore(grapeAvg.proof)}  (self-verification)`)
  console.log(`  E Expression ${formatScore(grapeAvg.expression)}  (communication quality)`)
  console.log(chalk.bold(`  ─────────────────────────`))
  console.log(chalk.bold(`  Composite   ${formatScore(grapeAvg.composite)}`))

  const overallIcon = passRate >= 0.8 ? chalk.green('✓')
    : passRate >= 0.6 ? chalk.yellow('⚠')
    : chalk.red('✗')

  console.log(chalk.bold(`\n${overallIcon} Overall: ${passed}/${results.length} passed (${Math.round(passRate * 100)}%)\n`))

  // ─── Save Results ─────────────────────────────────────────────────────────

  const suiteResult: TestSuiteResult = {
    suiteName: `eval-${new Date().toISOString()}`,
    runAt: new Date().toISOString(),
    totalCases: results.length,
    passedCases: passed,
    failedCases: failed,
    passRate,
    byLevel: buildLevelSummary(results),
    byCategory: buildCategorySummary(results),
    grapeAverage: grapeAvg,
    results,
  }

  await writeFile(
    resolve(config.outputDir, 'results.json'),
    JSON.stringify(suiteResult, null, 2),
    'utf-8',
  )

  await generateReport(suiteResult, config.outputDir)

  console.log(chalk.dim(`Reports saved to: ${config.outputDir}`))

  process.exit(failed > 0 ? 1 : 0)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0
}

function formatScore(score: number): string {
  const s = String(score).padStart(3)
  if (score >= 80) return chalk.green(`${s}/100`)
  if (score >= 60) return chalk.yellow(`${s}/100`)
  return chalk.red(`${s}/100`)
}

function buildLevelSummary(results: EvalResult[]) {
  const out: Record<string, unknown> = {}
  for (const level of ['S', 'M', 'L'] as TaskLevel[]) {
    const lr = results.filter(r => r.testCase.level === level)
    out[level] = {
      total: lr.length,
      passed: lr.filter(r => r.functionalPass).length,
      avgCompositeScore: avg(lr.map(r => r.grape.composite)),
      avgDurationMs: avg(lr.map(r => r.durationMs)),
      avgTurns: avg(lr.map(r => r.trace.turnCount)),
    }
  }
  return out as TestSuiteResult['byLevel']
}

function buildCategorySummary(results: EvalResult[]) {
  const out: Record<string, unknown> = {}
  const categories = [...new Set(results.map(r => r.testCase.category))] as TaskCategory[]
  for (const cat of categories) {
    const cr = results.filter(r => r.testCase.category === cat)
    const failed = cr.filter(r => !r.functionalPass)
    const patterns = failed.slice(0, 3).map(r => r.firstFailure || 'unknown').filter(Boolean)
    out[cat] = {
      total: cr.length,
      passed: cr.filter(r => r.functionalPass).length,
      avgCompositeScore: avg(cr.map(r => r.grape.composite)),
      topFailurePatterns: patterns,
    }
  }
  return out as TestSuiteResult['byCategory']
}

main().catch(console.error)
