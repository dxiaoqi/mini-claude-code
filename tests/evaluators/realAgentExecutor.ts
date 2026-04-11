#!/usr/bin/env node

/**
 * 真实Agent能力测试执行器
 *
 * 使用真实的API调用来测试Agent的智能问题解决能力
 */
import { config } from 'dotenv'
import { resolveApiConfig } from '../../src/utils/config.js'
import { createAnthropicClient } from '../../src/api/anthropicClient.js'
import { createSessionState } from '../../src/state/SessionState.js'
import { runAgentLoop } from '../../src/engine/AgentEngine.js'
import { BashTool } from '../../src/tools/local/BashTool.js'
import { FileReadTool } from '../../src/tools/local/FileReadTool.js'
import { FileWriteTool } from '../../src/tools/local/FileWriteTool.js'
import { FileEditTool } from '../../src/tools/local/FileEditTool.js'
import { GlobTool } from '../../src/tools/local/GlobTool.js'
import { GrepTool } from '../../src/tools/local/GrepTool.js'
import { AskUserTool } from '../../src/tools/interaction/AskUserTool.js'
import { createLogger } from '../../src/logging/index.js'

// 加载.env
config({ path: '.env' })

const logger = createLogger({
  name: 'real-agent-evaluator',
  level: 'info',
  pretty: true,
})

/**
 * 真实测试场景
 */
export interface RealTestScenario {
  /** 场景ID */
  id: string
  /** 场景名称 */
  name: string
  /** 用户提示 */
  prompt: string
  /** 初始文件（用于测试环境） */
  initialFiles?: Record<string, string>
  /** 预期行为（用于验证） */
  expectedBehaviors?: string[]
  /** 最大轮次限制 */
  maxTurns?: number
  /** 测试说明 */
  description?: string
  /** 预期输出包含的关键词 */
  expectedKeywords?: string[]
}

/**
 * 测试执行结果
 */
export interface RealTestResult {
  /** 场景ID */
  scenarioId: string
  /** 是否成功 */
  success: boolean
  /** 执行的轮次 */
  turns: number
  /** 完整的执行日志 */
  events: any[]
  /** Agent的最终响应 */
  finalResponse?: string
  /** 执行时间(ms) */
  duration: number
  /** 错误信息（如果有） */
  error?: string
  /** 能力评估 */
  capabilities: {
    understanding: boolean      // 是否理解了问题
    retrieval: boolean         // 是否主动检索信息
    analysis: boolean           // 是否进行了分析
    generation: boolean         // 是否生成了解决方案
    evaluation: boolean        // 是否进行了验证
  }
}

/**
 * Agent执行器
 */
export class RealAgentExecutor {
  private testDir: string
  private apiKey: string | null
  private baseUrl: string | null

  constructor(testDir: string) {
    this.testDir = testDir
    this.apiKey = process.env.ANTHROPIC_API_KEY || null
    this.baseUrl = process.env.ANTHROPIC_BASE_URL || null
  }

  /**
   * 检查API配置
   */
  private checkConfig(): void {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY not found in environment')
    }
    if (!this.baseUrl) {
      throw new Error('ANTHROPIC_BASE_URL not found in environment')
    }

    logger.info('API配置已加载')
  }

  /**
   * 执行一个真实测试场景
   */
  async executeScenario(scenario: RealTestScenario): Promise<RealTestResult> {
    logger.info('开始执行场景')

    const startTime = Date.now()
    const events: any[] = []

    try {
      // 1. 检查API配置
      this.checkConfig()

      // 2. 初始化测试环境
      await this.initializeEnvironment(scenario)

      // 3. 创建API客户端
      const apiClient = await this.createAPIClient()

      // 4. 创建Agent状态
      const sessionState = createSessionState({
        cwd: this.testDir,
      })

      // 5. 配置工具
      const tools = this.getTools()

      // 6. 运行Agent Loop
      logger.info('启动Agent Loop')

      const agentEvents = []
      for await (const event of runAgentLoop({
        state: sessionState,
        apiClient,
        tools,
        contextProviders: [],
        canUseTool: async (toolName: string) => ({ behavior: 'allow' }),
        maxTurns: scenario.maxTurns || 20,
        signal: new AbortController().signal
      })) {
        events.push(event)
        agentEvents.push(event)

        // 实时日志
        if (event.type === 'assistant_message') {
          logger.debug('Agent消息')
        } else if (event.type === 'tool_use') {
          logger.info('Agent使用工具', { tool: event.tool_name })
        }
      }

      const duration = Date.now() - startTime

      // 7. 评估执行结果
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

      logger.info({
        msg: '场景执行完成',
        scenario: scenario.id,
        success: result.success,
        turns: result.turns,
        duration: `${duration}ms`,
      })

      return result

    } catch (error: any) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      logger.error({
        msg: '场景执行失败',
        scenario: scenario.id,
        error: errorMessage,
      })

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

  /**
   * 初始化测试环境
   */
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

  /**
   * 创建API客户端
   */
  private async createAPIClient() {
    const { apiKey, baseUrl } = await resolveApiConfig(this.testDir)

    logger.info('创建API客户端')

    return createAnthropicClient({
      apiKey,
      baseUrl,
      model: process.env.MODEL || 'claude-sonnet-4-5-20250207',
    })
  }

  /**
   * 获取工具列表
   */
  private getTools() {
    return [
      new FileReadTool(),
      new FileWriteTool(),
      new FileEditTool(),
      new GlobTool(),
      new GrepTool(),
      new BashTool(),
      // AskUserTool - 评估模式下不启用交互
    ]
  }

  /**
   * 提取最终响应
   */
  private extractFinalResponse(events: any[]): string | undefined {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event.type === 'assistant_message' && event.content) {
        return event.content
      }
    }
    return undefined
  }

  /**
   * 计算执行轮次
   */
  private countTurns(events: any[]): number {
    return events.filter(e => e.type === 'user_message' || e.type === 'assistant_message').length / 2
  }

  /**
   * 评估能力
   */
  private evaluateCapabilities(events: any[], scenario: RealTestScenario) {
    const capabilities = {
      understanding: false,
      retrieval: false,
      analysis: false,
      generation: false,
      evaluation: false,
    }

    // 1. 理解能力 - 检查Agent是否在合理时间内开始工作
    const firstResponseTime = this.findFirstResponseTime(events)
    capabilities.understanding = firstResponseTime < 30000 // 30秒内响应

    // 2. 检索能力 - 检查是否使用了搜索工具
    capabilities.retrieval = events.some(e =>
      e.type === 'tool_use' &&
      (e.tool_name === 'GlobTool' || e.tool_name === 'GrepTool')
    )

    // 3. 分析能力 - 检查消息中是否包含分析性关键词
    const hasAnalysisKeywords = events.some(e =>
      e.type === 'assistant_message' &&
      e.content &&
      (e.content.includes('分析') ||
       e.content.includes('问题') ||
       e.content.includes('原因') ||
       e.content.includes('考虑'))
    )
    capabilities.analysis = hasAnalysisKeywords

    // 4. 生成能力 - 检查是否使用了代码生成工具
    capabilities.generation = events.some(e =>
      e.type === 'tool_use' &&
      (e.tool_name === 'FileWriteTool' ||
       e.tool_name === 'FileEditTool') &&
      !e.is_error
    )

    // 5. 评估能力 - 检查是否使用了验证工具（bash运行测试等）
    capabilities.evaluation = events.some(e =>
      e.type === 'tool_use' &&
      e.tool_name === 'BashTool' &&
      e.content?.includes('test') &&
      !e.is_error
    )

    return capabilities
  }

  /**
   * 查找第一次响应时间
   */
  private findFirstResponseTime(events: any[]): number {
    let startTime = events[0]?.timestamp || 0

    for (const event of events) {
      if (event.type === 'assistant_message') {
        return event.timestamp - startTime
      }
    }

    return 0
  }

  /**
   * 生成详细的执行报告
   */
  generateDetailedReport(result: RealTestResult): string {
    const lines: string[] = [
      '='.repeat(80),
      `场景: ${result.scenarioId}`,
      '='.repeat(80),
      '',
      `状态: ${result.success ? '✓ 成功' : '✗ 失败'}`,
      `轮次: ${result.turns}`,
      `耗时: ${result.duration}ms`,
      '',
      '-' .repeat(80),
      '能力评估',
      '-' .repeat(80),
      '',
      `理解能力: ${result.capabilities.understanding ? '✓' : '✗'} - ${result.capabilities.understanding ? '正常响应' : '响应过慢'}`,
      `检索能力: ${result.capabilities.retrieval ? '✓' : '✗'} - ${result.capabilities.retrieval ? '主动查找信息' : '未检索'}`,
      `分析能力: ${result.capabilities.analysis ? '✓' : '✗'} - ${result.capabilities.analysis ? '进行了分析' : '缺少分析'}`,
      `生成能力: ${result.capabilities.generation ? '✓' : '✗'} - ${result.capabilities.generation ? '生成了解决方案' : '未生成'}`,
      `评估能力: ${result.capabilities.evaluation ? '✓' : '✗'} - ${result.capabilities.evaluation ? '进行了验证' : '未验证'}`,
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
        lines.push(`(共${result.finalResponse.length}字符)`)
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

    lines.push('-'.repeat(80))
    lines.push('执行事件')
    lines.push('-'.repeat(80))
    lines.push('')

    for (const event of result.events.slice(0, 20)) {
      const timestamp = new Date(event.timestamp || 0).toLocaleTimeString()
      if (event.type === 'user_message') {
        lines.push(`[${timestamp}] 用户消息: ${event.content?.substring(0, 50)}...`)
      } else if (event.type === 'assistant_message') {
        lines.push(`[${timestamp}] Agent消息: ${event.content?.substring(0, 50)}...`)
      } else if (event.type === 'tool_use') {
        lines.push(`[${timestamp}] 工具调用: ${event.tool_name}`)
        if (event.input) {
          const inputStr = JSON.stringify(event.input).substring(0, 80)
          lines.push(`           输入: ${inputStr}...`)
        }
      } else if (event.type === 'tool_result') {
        const status = event.is_error ? '失败' : '成功'
        lines.push(`[${timestamp}] 工具结果: ${status}`)
      }
    }

    if (result.events.length > 20) {
      lines.push(`...(还有${result.events.length - 20}个事件)`)
    }

    lines.push('')
    lines.push('='.repeat(80))

    return lines.join('\n')
  }
}

/**
 * 预定义的真实测试场景
 */
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
  {
    id: 'code-refactoring',
    name: '代码重构',
    prompt: '请重构duplicate.ts文件，将重复的验证逻辑提取为通用的validateField函数。',
    description: '测试Agent重构代码和提取模式的能力',
    initialFiles: {
      'duplicate.ts': `
function validateUser(user: any) {
  if (!user.name) throw new Error('Name required');
  if (!user.email) throw new Error('Email required');
  if (!user.age) throw new Error('Age required');
}

function validateProduct(product: any) {
  if (!product.name) throw new Error('Name required');
  if (!product.price) throw new Error('Price required');
  if (!product.description) throw new Error('Description required');
}
`.trim(),
    },
    maxTurns: 10,
    expectedKeywords: ['validate', '函数', '参数'],
  },
  {
    id: 'file-organization',
    name: '文件组织',
    prompt: '请帮我分析当前目录的文件结构，创建一个README.md文件说明项目的组织方式。',
    description: '测试Agent分析和组织文件的能力',
    initialFiles: {
      'src/utils/helper.ts': '// Helper functions',
      'src/api/client.ts': '// API client',
      'src/models/user.ts': '// User model',
      'package.json': JSON.stringify({ name: 'test-project' }, null, 2),
    },
    maxTurns: 8,
    expectedKeywords: ['README', '结构', '文件'],
  },
  {
    id: 'debug-and-fix',
    name: '调试和修复',
    prompt: '请帮我调试problematic.ts文件中的问题。在运行时会出现"Cannot read property"错误。',
    description: '测试Agent调试和修复运行时错误的能力',
    initialFiles: {
      'problematic.ts': `
function processData(data: any[]) {
  return data.map(item => {
    return item.value.toUpperCase();
  });
}

processData([{name: 'Alice'}]);
`.trim(),
    },
    maxTurns: 10,
    expectedKeywords: ['undefined', '检查', '修复'],
  },
]

/**
 * 创建执行器实例
 */
export function createRealAgentExecutor(testDir: string): RealAgentExecutor {
  return new RealAgentExecutor(testDir)
}

/**
 * 运行所有场景
 */
export async function runAllRealScenarios(
  testDir: string,
  scenarios: RealTestScenario[] = realTestScenarios
): Promise<RealTestResult[]> {
  const executor = createRealAgentExecutor(testDir)
  const results: RealTestResult[] = []

  logger.info('开始批量执行真实Agent测试')

  for (const scenario of scenarios) {
    try {
      const result = await executor.executeScenario(scenario)
      results.push(result)
    } catch (error) {
      logger.error({ msg: '场景执行异常', scenario: scenario.id, error })
      // 继续执行下一个场景
    }
  }

  return results
}

/**
 * 生成综合报告
 */
export function generateRealTestReport(results: RealTestResult[]): string {
  const lines: string[] = [
    '='.repeat(80),
    '真实Agent能力测试综合报告',
    '='.repeat(80),
    '',
    `测试场景数: ${results.length}`,
    `成功场景: ${results.filter(r => r.success).length}`,
    `成功率:   ${(results.filter(r => r.success).length / results.length * 100).toFixed(1)}%`,
    '',
    '-' .repeat(80),
    '各场景详情',
    '-' .repeat(80),
    '',
  ]

  for (const result of results) {
    lines.push(`场景: ${result.scenarioId}`)
    lines.push(`  状态: ${result.success ? '✓ 成功' : '✗ 失败'}`)
    lines.push(`  轮次: ${result.turns}`)
    lines.push(`  耗时: ${result.duration}ms`)
    lines.push('  能力:')
    lines.push(`    理解: ${result.capabilities.understanding ? '✓' : '✗'}`)
    lines.push(`    检索: ${result.capabilities.retrieval ? '✓' : '✗'}`)
    lines.push(`    分析: ${result.capabilities.analysis ? '✓' : '✗'}`)
    lines.push(`    生成: ${result.capabilities.generation ? '✓' : '✗'}`)
    lines.push(`    评估: ${result.capabilities.evaluation ? '✓' : '✗'}`)
    lines.push('')
  }

  // 能力统计
  const hasAllCapabilities = results.every(r =>
    r.capabilities.understanding &&
    r.capabilities.retrieval &&
    r.capabilities.analysis &&
    r.capabilities.generation &&
    r.capabilities.evaluation
  )

  lines.push('-'.repeat(80))
  lines.push('能力统计')
  lines.push('-'.repeat(80))
  lines.push('')

  const withUnderstanding = results.filter(r => r.capabilities.understanding).length
  const withRetrieval = results.filter(r => r.capabilities.retrieval).length
  const withAnalysis = results.filter(r => r.capabilities.analysis).length
  const withGeneration = results.filter(r => r.capabilities.generation).length
  const withEvaluation = results.filter(r => r.capabilities.evaluation).length

  lines.push(`具备理解能力: ${withUnderstanding}/${results.length}`)
  lines.push(`具备检索能力: ${withRetrieval}/${results.length}`)
  lines.push(`具备分析能力: ${withAnalysis}/${results.length}`)
  lines.push(`具备生成能力: ${withGeneration}/${results.length}`)
  lines.push(`具备评估能力: ${withEvaluation}/${results.length}`)
  lines.push('')

  const avgTurns = results.reduce((sum, r) => sum + r.turns, 0) / results.length
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length

  lines.push(`平均轮次: ${avgTurns.toFixed(1)}`)
  lines.push(`平均耗时: ${avgDuration.toFixed(0)}ms`)
  lines.push('')

  if (hasAllCapabilities) {
    lines.push('✓ Agent具备所有测试的能力！')
  } else {
    lines.push('✗ Agent部分能力需要改进。')
  }

  lines.push('')
  lines.push('='.repeat(80))

  return lines.join('\n')
}

/**
 * 主函数（导出用于CLI调用）
 */
export async function main(scenarioIds?: string[]) {
  logger.info('开始真实Agent能力测试')

  // 创建测试目录
  const fs = await import('fs/promises')
  const path = await import('path')
  const os = await import('os')

  const testDir = path.join(os.tmpdir(), `real-agent-test-${Date.now()}`)
  await fs.mkdir(testDir, { recursive: true })

  logger.info('测试目录已创建')

  try {
    // 选择要运行的场景
    const scenarios = scenarioIds && scenarioIds.length > 0
      ? realTestScenarios.filter(s => scenarioIds.includes(s.id))
      : realTestScenarios

    logger.info({ msg: `将执行 ${scenarios.length} 个测试场景` })

    // 运行所有场景
    const results = await runAllRealScenarios(testDir, scenarios)

    // 生成综合报告
    const report = generateRealTestReport(results)
    const reportPath = path.join(testDir, 'real-agent-test-report.md')

    await fs.writeFile(reportPath, report, 'utf-8')
    logger.info('报告已生成')

    // 生成每个场景的详细报告
    for (const result of results) {
      const detailedReport = new RealAgentExecutor(testDir).generateDetailedReport(result)
      const scenarioReportPath = path.join(testDir, `${result.scenarioId}-report.md`)
      await fs.writeFile(scenarioReportPath, detailedReport, 'utf-8')
    }

    // 输出摘要
    console.log('\n' + '='.repeat(80))
    console.log('真实Agent能力测试摘要')
    console.log('='.repeat(80) + '\n')

    const summary = generateSummary(results)
    console.log(summary)

    console.log(`\n详细报告已保存到: ${testDir}`)

    return results

  } catch (error) {
    logger.error({ msg: '测试失败', error })
    console.error('错误:', error)
    process.exit(1)
  } finally {
    // 可选：清理测试目录
    // await fs.rm(testDir, { recursive: true })
  }
}

/**
 * 生成摘要
 */
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

  lines.push(`总场景数:     ${total}`)
  lines.push(`成功场景数:   ${successful}`)
  lines.push(`成功率:       ${(successful / total * 100).toFixed(1)}%`)
  lines.push(`平均能力得分: ${avgScore.toFixed(1)}/5`)

  const avgTurns = results.reduce((sum, r) => sum + r.turns, 0) / results.length
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length

  lines.push(`平均轮次:     ${avgTurns.toFixed(1)}`)
  lines.push(`平均耗时:     ${avgDuration.toFixed(0)}ms`)

  lines.push('')

  // 能力评级
  const rating = getRating(avgScore)
  lines.push(`总体评级:     ${rating.text}`)
  lines.push(`               ${rating.description}`)

  return lines.join('\n')
}

/**
 * 获取评级
 */
function getRating(score: number) {
  if (score >= 5) return { text: 'S - 卓越', description: 'Agent具备卓越的问题解决能力' }
  if (score >= 4) return { text: 'A - 优秀', description: 'Agent具备良好的问题解决能力' }
  if (score >= 3) return { text: 'B - 良好', description: 'Agent具备基本的问题解决能力' }
  if (score >= 2) return { text: 'C - 合格', description: 'Agent能完成部分任务，需要改进' }
  return { text: 'D - 需要改进', description: 'Agent的问题解决能力不足' }
}
