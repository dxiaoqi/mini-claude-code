#!/usr/bin/env node

/**
 * Agent Loop 能力评估运行器
 *
 * 运行预定义的测试场景并生成评估报告
 */
import { createTestDir, cleanupTestDir } from '../utils/testHelpers.js'
import { runAllScenarios, generateComprehensiveReport, testScenarios } from './agentExecutor.js'
import { createLogger } from '../../src/logging/index.js'

const logger = createLogger({
  name: 'agent-evaluation',
  level: 'info',
  pretty: true,
})

/**
 * 主函数
 */
async function main() {
  logger.info({ msg: '开始Agent Loop能力评估' })

  let testDir: string | null = null

  try {
    // 1. 创建测试目录
    testDir = await createTestDir('agent-loop-evaluation')
    logger.info({ msg: '测试目录已创建', testDir })

    // 2. 选择要运行的场景
    const scenarios = testScenarios
    logger.info({ msg: `将执行 ${scenarios.length} 个测试场景` })

    // 3. 运行所有场景
    const startTime = Date.now()
    const results = await runAllScenarios(testDir, scenarios)
    const duration = Date.now() - startTime

    logger.info({
      msg: '所有场景执行完成',
      duration: `${duration}ms`,
      successCount: results.filter(r => r.success).length,
    })

    // 4. 生成报告
    const report = generateComprehensiveReport(results)

    // 5. 保存报告
    const reportPath = `${testDir}/evaluation-report.md`
    const fs = await import('fs/promises')
    await fs.writeFile(reportPath, report, 'utf-8')

    logger.info({ msg: '评估报告已生成', reportPath })

    // 6. 输出摘要
    console.log('\n' + '='.repeat(80))
    console.log('Agent Loop 能力评估摘要')
    console.log('='.repeat(80) + '\n')

    const summary = generateSummary(results)
    console.log(summary)

    console.log(`\n完整报告已保存到: ${reportPath}`)

  } catch (error) {
    logger.error({ msg: '评估失败', error })
    console.error('错误:', error)
    process.exit(1)
  } finally {
    // 清理测试目录（可选，根据需求）
    if (testDir) {
      logger.info({ msg: '清理测试目录' })
      // await cleanupTestDir(testDir)
    }
  }
}

/**
 * 生成摘要
 */
function generateSummary(results: any[]): string {
  const lines: string[] = []

  const total = results.length
  const successful = results.filter(r => r.success).length
  const avgScore = results.reduce((sum, r) => sum + r.report.totalScore, 0) / total
  const avgTurns = results.reduce((sum, r) => sum + r.turns, 0) / total

  lines.push(`总场景数:     ${total}`)
  lines.push(`成功场景数:   ${successful}`)
  lines.push(`成功率:       ${(successful / total * 100).toFixed(1)}%`)
  lines.push(`平均总分:     ${avgScore.toFixed(1)}/50`)
  lines.push(`平均轮次:     ${avgTurns.toFixed(1)}`)
  lines.push('')

  // 评级颜色
  const rating = getRatingColor(avgScore)
  lines.push(`总体评级:     ${rating} ${getRatingText(avgScore)}`)

  // 能力雷达图（文本）
  const avgUnderstanding = results.reduce((sum, r) => sum + r.report.scores.understanding, 0) / total
  const avgRetrieval = results.reduce((sum, r) => sum + r.report.scores.retrieval, 0) / total
  const avgAnalysis = results.reduce((sum, r) => sum + r.report.scores.analysis, 0) / total
  const avgGeneration = results.reduce((sum, r) => sum + r.report.scores.generation, 0) / total
  const avgEvaluation = results.reduce((sum, r) => sum + r.report.scores.evaluation, 0) / total

  lines.push('')
  lines.push('各能力平均分:')
  lines.push(`  理解能力: ${generateBar(avgUnderstanding, 10)}`)
  lines.push(`  检索能力: ${generateBar(avgRetrieval, 10)}`)
  lines.push(`  分析能力: ${generateBar(avgAnalysis, 10)}`)
  lines.push(`  生成能力: ${generateBar(avgGeneration, 10)}`)
  lines.push(`  评估能力: ${generateBar(avgEvaluation, 10)}`)

  return lines.join('\n')
}

/**
 * 获取评级颜色
 */
function getRatingColor(score: number): string {
  if (score >= 45) return '\x1b[32mS' // 绿色
  if (score >= 35) return '\x1b[34mA' // 蓝色
  if (score >= 25) return '\x1b[33mB' // 黄色
  if (score >= 15) return '\x1b[36mC' // 青色
  return '\x1b[31mD' // 红色
}

/**
 * 获取评级文本
 */
function getRatingText(score: number): string {
  if (score >= 45) return '卓越'
  if (score >= 35) return '优秀'
  if (score >= 25) return '良好'
  if (score >= 15) return '合格'
  return '需改进'
}

/**
 * 生成可视化条形图
 */
function generateBar(value: number, max: number): string {
  const percentage = value / max
  const length = Math.floor(percentage * 20)
  const filled = '█'.repeat(length)
  const empty = '░'.repeat(20 - length)
  const color = getBarColor(percentage)

  return `${color}${filled}${empty}\x1b[0m ${value.toFixed(1)}/${max}`
}

/**
 * 获取条形图颜色
 */
function getBarColor(percentage: number): string {
  if (percentage >= 0.8) return '\x1b[32m' // 绿色
  if (percentage >= 0.6) return '\x1b[34m' // 蓝色
  if (percentage >= 0.4) return '\x1b[33m' // 黄色
  return '\x1b[31m' // 红色
}

// 运行主函数
main().catch(error => {
  console.error('错误:', error)
  process.exit(1)
})
