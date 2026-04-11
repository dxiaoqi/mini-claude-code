#!/usr/bin/env node

/**
 * 真实Agent能力测试执行器 - 修复版
 *
 * 使用真实的API调用来测试Agent的智能问题解决能力
 */
import { createAnthropicClient } from '../../src/api/anthropicClient.js'
import { createSessionState } from '../../src/state/SessionState.js'
import { runAgentLoop } from '../../src/engine/AgentEngine.js'
import { BashTool } from '../../src/tools/local/BashTool.js'
import { FileReadTool } from '../../src/tools/local/FileReadTool.js'
import { FileWriteTool } from '../../src/tools/local/FileWriteTool.js'
import { FileEditTool } from '../../src/tools/local/FileEditTool.js'
import { GlobTool } from '../../src/tools/local/GlobTool.js'
import { GrepTool } from '../../src/tools/local/GrepTool.js'
import { createLogger } from '../../src/logging/index.js'
import { resolveApiConfig } from '../../src/utils/config.js'

const logger = createLogger({
  name: 'real-agent-evaluator',
  level: 'info',
  pretty: true,
})

/**
 * 真实测试场景
 */
export interface RealTestScenario {
  id: string
  name: string
  prompt: string
  initialFiles?: Record<string, string>
  maxTurns?: number
  description?: string
  expectedKeywords?: string[]
}

/**
 * 测试执行结果
 */
export interface RealTestResult {
  scenarioId: string
  success: boolean
  turns: number
  events: any[]
  finalResponse?: string
  duration: number
  error?: string
  capabilities: {
    understanding: boolean
    retrieval: boolean
    analysis: boolean
    generation: boolean
    evaluation: boolean
  }
}

/**
 * Agent执行器
 */
export class RealAgentExecutor {
  private testDir: string

  constructor(testDir: string) {
    this.testDir = testDir
  }

  async executeScenario(scenario: RealTestScenario): Promise<RealTestResult> {
    logger.info('开始执行场景: ' + scenario.id)

    const startTime = Date.now()
    const events: any[] = []

    try {
      // 1. 初始化测试环境
      await this.initializeEnvironment(scenario)

      // 2. 创建API客户端
      const apiClient = await this.createAPIClient()

      // 3. 创建Agent状态
      const sessionState = createSessionState({
        cwd: this.testDir,
      })

      // 4. 配置工具
      const tools = this.getTools()

      // 5. 运行Agent Loop
      logger.info('启动Agent Loop')

      const agentEvents = []
      for await (const event of runAgentLoop({
        state: sessionState,
        config: {
          apiClient,
          tools,
          contextProviders: [],
          maxTurns: scenario.maxTurns || 20,
        },
        userContent: scenario.prompt,
      })) {
        events.push(event)
        agentEvents.push(event)

        // 实时日志
        if (event.type === 'assistant_message') {
          logger.debug('Agent消息: ' + (event.content?.substring(0, 50) || ''))
        } else if (event.type === 'tool_use') {
          logger.info('Agent使用工具: ' + (event.tool_name || ''))
        }
      }

      const duration = Date.now() - startTime

      // 6. 评估执行结果
      const finalResponse = this.extractFinalResponse(agentEvents)
      const capabilities = this.evaluateCapabilities(agentEvents, scenario)

      const result: RealTestResult = {
        scenarioId: scenario.id,
        success: capabilities.understanding && capabilities.generation,
        turns: this.countTurns(agentEvents),
        events: agentEvents,
        finalResponse,
        duration,
        capabilities,
      }

      logger.info('场景执行完成: ' + scenario.id)

      return result

    } catch (error: any) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      logger.error('场景执行失败: ' + scenario.id + ', 错误: ' + errorMessage)

      return {
        scenarioId: scenario.id,
        success: false,
        turns: 0,
        events,
        duration,
        error: errorMessage,
        capabilities: {
          understanding: false,
          retrieval: false,
          analysis: false,
          generation: false,
          evaluation: false,
        },
      }
    }
  }

  private async initializeEnvironment(scenario: RealTestScenario): Promise<void> {
    logger.info('初始化测试环境')

    if (scenario.initialFiles) {
      const fs = await import('fs/promises')
      const path = await import('path')

      for (const [filename, content] of Object.entries(scenario.initialFiles)) {
        const filepath = path.join(this.testDir, filename)
        await fs.mkdir(path.dirname(filepath), { recursive: true })
        await fs.writeFile(filepath, content, 'utf-8')
      }
    }
  }

  private async createAPIClient() {
    const { apiKey, baseUrl } = await resolveApiConfig(this.testDir)

    logger.info('创建API客户端: ' + baseUrl.substring(0, 40))

    return createAnthropicClient({
      apiKey,
      baseUrl,
      model: process.env.MODEL || 'claude-sonnet-4-5-20250207',
    })
  }

  private getTools() {
    return [
      new FileReadTool(),
      new FileWriteTool(),
      new FileEditTool(),
      new GlobTool(),
      new GrepTool(),
      new BashTool(),
    ]
  }

  private extractFinalResponse(events: any[]): string | undefined {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event.type === 'assistant_message' && event.content) {
        return event.content
      }
    }
    return undefined
  }

  private countTurns(events: any[]): number {
    return events.filter(e => e.type === 'user_message' || e.type === 'assistant_message').length / 2
  }

  private evaluateCapabilities(events: any[], scenario: RealTestScenario) {
    const capabilities = {
      understanding: false,
      retrieval: false,
      analysis: false,
      generation: false,
      evaluation: false,
    }

    const firstResponseTime = this.findFirstResponseTime(events)
    capabilities.understanding = firstResponseTime < 30000

    capabilities.retrieval = events.some(e =>
      e.type === 'tool_use' &&
      (e.tool_name === 'GlobTool' || e.tool_name === 'GrepTool')
    )

    const hasAnalysisKeywords = events.some(e =>
      e.type === 'assistant_message' &&
      e.content &&
      (e.content.includes('分析') ||
       e.content.includes('问题') ||
       e.content.includes('原因') ||
       e.content.includes('考虑'))
    )
    capabilities.analysis = hasAnalysisKeywords

    capabilities.generation = events.some(e =>
      e.type === 'tool_use' &&
      (e.tool_name === 'FileWriteTool' ||
       e.tool_name === 'FileEditTool') &&
      !e.is_error
    )

    capabilities.evaluation = events.some(e =>
      e.type === 'tool_use' &&
      e.tool_name === 'BashTool' &&
      e.content?.includes('test') &&
      !e.is_error
    )

    return capabilities
  }

  private findFirstResponseTime(events: any[]): number {
    const startTime = events[0]?.timestamp || 0

    for (const event of events) {
      if (event.type === 'assistant_message') {
        return event.timestamp - startTime
      }
    }

    return 0
  }

  generateDetailedReport(result: RealTestResult): string {
    const lines: string[] = [
      '='.repeat(80),
      '场景: ' + result.scenarioId,
      '='.repeat(80),
      '',
      '状态: ' + (result.success ? '✓ 成功' : '✗ 失败'),
      '轮次: ' + result.turns,
      '耗时: ' + result.duration + 'ms',
      '',
      '-' .repeat(80),
      '能力评估',
      '-' .repeat(80),
      '',
      '理解能力: ' + (result.capabilities.understanding ? '✓' : '✗'),
      '检索能力: ' + (result.capabilities.retrieval ? '✓' : '✗'),
      '分析能力: ' + (result.capabilities.analysis ? '✓' : '✗'),
      '生成能力: ' + (result.capabilities.generation ? '✓' : '✗'),
      '评估能力: ' + (result.capabilities.evaluation ? '✓' : '✗'),
      '',
    ]

    if (result.finalResponse) {
      lines.push('-'.repeat(80))
      lines.push('Agent最终响应')
      lines.push('-'.repeat(80))
      lines.push('')
      lines.push(result.finalResponse.substring(0, 500))
      if (result.finalResponse.length > 500) {
        lines.push('...')
        lines.push('(共' + result.finalResponse.length + '字符)')
      }
      lines.push('')
    }

    if (result.error) {
      lines.push('-'.repeat(80))
      lines.push('错误信息')
      lines.push('-'.repeat(80))
      lines.push('')
      lines.push(result.error)
      lines.push('')
    }

    lines.push('='.repeat(80))

    return lines.join('\n')
  }
}

export const realTestScenarios: RealTestScenario[] = [
  {
    id: 'bug-fix-simple',
    name: '简单Bug修复',
    prompt: '请帮我修复文件buggy.ts中的bug。calculateSum函数有一个循环索引问题。',
    description: '测试Agent修复简单代码bug的能力',
    initialFiles: {
      'buggy.ts': `
function calculateSum(items: number[]): number {
  let sum = 0;
  for (let i = 1; i < items.length; i++) {
    sum += items[i];
  }
  return sum;
}

// Bug: 循环从1开始，漏掉了items[0]
`.trim(),
    },
    maxTurns: 10,
    expectedKeywords: ['修复', '0', '循环'],
  },
  {
    id: 'feature-implementation',
    name: '功能实现',
    prompt: '请实现一个计算斐波那契数列的函数，放在fibonacci.ts文件中。',
    description: '测试Agent实现新功能的能力',
    initialFiles: {
      'fibonacci.ts': '// TODO: 实现斐波那契函数\n',
    },
    maxTurns: 10,
    expectedKeywords: ['fibonacci', '递归', '函数'],
  },
]

export async function runAllRealScenarios(
  testDir: string,
  scenarios: RealTestScenario[] = realTestScenarios
): Promise<RealTestResult[]> {
  const executor = new RealAgentExecutor(testDir)
  const results: RealTestResult[] = []

  logger.info('开始批量执行真实Agent测试，场景数: ' + scenarios.length)

  for (const scenario of scenarios) {
    try {
      const result = await executor.executeScenario(scenario)
      results.push(result)
    } catch (error) {
      logger.error('场景执行异常: ' + scenario.id + ', 错误: ' + (error as Error).message)
    }
  }

  return results
}

export function generateRealTestReport(results: RealTestResult[]): string {
  const lines: string[] = [
    '='.repeat(80),
    '真实Agent能力测试综合报告',
    '='.repeat(80),
    '',
    '测试场景数: ' + results.length,
    '成功场景: ' + results.filter(r => r.success).length,
    '成功率: ' + ((results.filter(r => r.success).length / results.length * 100).toFixed(1)) + '%',
    '',
    '-' .repeat(80),
    '各场景详情',
    '-' .repeat(80),
    '',
  ]

  for (const result of results) {
    lines.push('场景: ' + result.scenarioId)
    lines.push('  状态: ' + (result.success ? '✓ 成功' : '✗ 失败'))
    lines.push('  轮次: ' + result.turns)
    lines.push('  耗时: ' + result.duration + 'ms')
    lines.push('  能力:')
    lines.push('    理解: ' + (result.capabilities.understanding ? '✓' : '✗'))
    lines.push('    检索: ' + (result.capabilities.retrieval ? '✓' : '✗'))
    lines.push('    分析: ' + (result.capabilities.analysis ? '✓' : '✗'))
    lines.push('    生成: ' + (result.capabilities.generation ? '✓' : '✗'))
    lines.push('    评估: ' + (result.capabilities.evaluation ? '✓' : '✗'))
    lines.push('')
  }

  lines.push('='.repeat(80))

  return lines.join('\n')
}

export async function main(scenarioIds?: string[]) {
  logger.info('开始真实Agent能力测试')

  const fs = await import('fs/promises')
  const path = await import('path')
  const os = await import('os')

  const testDir = path.join(os.tmpdir(), 'real-agent-test-' + Date.now())
  await fs.mkdir(testDir, { recursive: true })

  logger.info('测试目录已创建: ' + testDir)

  try {
    const scenarios = scenarioIds && scenarioIds.length > 0
      ? realTestScenarios.filter(s => scenarioIds.includes(s.id))
      : realTestScenarios

    logger.info('将执行 ' + scenarios.length + ' 个测试场景')

    const results = await runAllRealScenarios(testDir, scenarios)

    const report = generateRealTestReport(results)
    const reportPath = path.join(testDir, 'real-agent-test-report.md')
    await fs.writeFile(reportPath, report, 'utf-8')
    logger.info('报告已生成: ' + reportPath)

    for (const result of results) {
      const detailedReport = new RealAgentExecutor(testDir).generateDetailedReport(result)
      const scenarioReportPath = path.join(testDir, result.scenarioId + '-report.md')
      await fs.writeFile(scenarioReportPath, detailedReport, 'utf-8')
    }

    const summary = generateSummary(results)
    console.log('\n' + summary)
    console.log('\n详细报告已保存到: ' + testDir)

    return results

  } catch (error) {
    logger.error('测试失败', error)
    console.error('错误:', error)
    process.exit(1)
  }
}

function generateSummary(results: RealTestResult[]): string {
  const lines: string[] = []

  const total = results.length
  const successful = results.filter(r => r.success).length
  const avgScore = results.reduce((sum, r) => {
    const score = (r.capabilities.understanding ? 1 : 0) +
                   (r.capabilities.retrieval ? 1 : 0) +
                   (r.capabilities.analysis ? 1 : 0) +
                   (r.capabilities.generation ? 1 : 0) +
                   (r.capabilities.evaluation ? 1 : 0)
    return sum + score
  }, 0) / results.length

  lines.push('总场景数: ' + total)
  lines.push('成功场景: ' + successful)
  lines.push('成功率: ' + ((successful / total * 100).toFixed(1)) + '%')
  lines.push('平均能力得分: ' + avgScore.toFixed(1) + '/5')

  const avgTurns = results.reduce((sum, r) => sum + r.turns, 0) / results.length
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length

  lines.push('平均轮次: ' + avgTurns.toFixed(1))
  lines.push('平均耗时: ' + avgDuration.toFixed(0) + 'ms')

  lines.push('')

  const rating = getRating(avgScore)
  lines.push('总体评级: ' + rating.text)
  lines.push('              ' + rating.description)

  return lines.join('\n')
}

function getRating(score: number) {
  if (score >= 5) return { text: 'S - 卓越', description: 'Agent具备卓越的问题解决能力' }
  if (score >= 4) return { text: 'A - 优秀', description: 'Agent具备良好的问题解决能力' }
  if (score >= 3) return { text: 'B - 良好', description: 'Agent具备基本的问题解决能力' }
  if (score >= 2) return { text: 'C - 合格', description: 'Agent能完成部分任务，需要改进' }
  return { text: 'D - 需要改进', description: 'Agent的问题解决能力不足' }
}
