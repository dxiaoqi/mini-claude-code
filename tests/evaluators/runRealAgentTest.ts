#!/usr/bin/env node

/**
 * 真实Agent能力测试执行器 - 简化版本
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

export interface RealTestScenario {
  id: string
  name: string
  prompt: string
  initialFiles?: Record<string, string>
  maxTurns?: number
}

export interface RealTestResult {
  scenarioId: string
  success: boolean
  turns: number
  events: any[]
  finalResponse?: string
  duration: number
  error?: string
}

export const realTestScenarios: RealTestScenario[] = [
  {
    id: 'bug-fix-simple',
    name: '简单Bug修复',
    prompt: '请帮我修复文件buggy.ts中的bug。calculateSum函数有一个循环索引问题。',
    description: '测试Agent修复简单代码bug的能力',
    initialFiles: {
      'buggy.ts': 'function calculateSum(items: number[]): number { let sum = 0; for (let i = 1; i < items.length; i++) { sum += items[i]; } return sum; }',
    },
    maxTurns: 5,
  },
  {
    id: 'feature-implementation',
    name: '功能实现',
    prompt: '请实现一个计算斐波那契数列的函数，放在fibonacci.ts文件中。',
    description: '测试Agent实现新功能的能力',
    initialFiles: {
      'fibonacci.ts': '// TODO: 实现斐波那契函数',
    },
    maxTurns: 5,
  },
]

export async function runRealAgentTest(
  testDir: string,
  scenarioId: string
): Promise<RealTestResult> {
  const scenario = realTestScenarios.find(s => s.id === scenarioId)
  if (!scenario) {
    throw new Error('Scenario not found: ' + scenarioId)
  }

  console.log('\n开始执行场景: ' + scenario.name + ' (' + scenario.id + ')')
  console.log('提示: ' + scenario.prompt)
  console.log('')

  const startTime = Date.now()
  const events: any[] = []

  try {
    // 1. 初始化测试环境
    console.log('初始化测试环境...')
    const fs = await import('fs/promises')
    const path = await import('path')

    if (scenario.initialFiles) {
      for (const [filename, content] of Object.entries(scenario.initialFiles)) {
        const filepath = path.join(testDir, filename)
        await fs.mkdir(path.dirname(filepath), { recursive: true })
        await fs.writeFile(filepath, content, 'utf-8')
      }
    }

    // 2. 创建API客户端
    console.log('创建API客户端...')
    const apiKey = process.env.ANTHROPIC_API_KEY || ''
    const baseUrl = process.env.ANTHROPIC_BASE_URL || ''

    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not found')
    }

    const apiClient = createAnthropicClient({
      apiKey,
      baseUrl,
      model: process.env.MODEL || 'claude-sonnet-4-5-20250207',
    })

    // 3. 创建Agent状态
    const sessionState = createSessionState({
      cwd: testDir,
    })

    // 4. 配置工具
    const tools = [
      new FileReadTool(),
      new FileWriteTool(),
      new FileEditTool(),
      new GlobTool(),
      new GrepTool(),
      new BashTool(),
    ]

    // 5. 运行Agent Loop
    console.log('启动Agent Loop (最大轮次: ' + (scenario.maxTurns || 5) + ')...')
    console.log('')

    for await (const event of runAgentLoop({
      state: sessionState,
      config: {
        apiClient,
        tools,
        contextProviders: [],
        maxTurns: scenario.maxTurns || 5,
      },
      userContent: scenario.prompt,
    })) {
      events.push(event)

      // 实时日志
      if (event.type === 'assistant_message') {
        const content = (event.content || '').substring(0, 100)
        console.log('\nAgent:', content + '...')
      } else if (event.type === 'tool_use') {
        console.log('Tool:', event.tool_name)
      } else if (event.type === 'tool_result') {
        const status = event.is_error ? '失败' : '成功'
        console.log('Tool Result:', status)
      }
    }

    const duration = Date.now() - startTime

    // 6. 评估结果
    const finalResponse = extractFinalResponse(events)
    const turns = countTurns(events)

    const result: RealTestResult = {
      scenarioId: scenario.id,
      success: !!finalResponse && turns > 0,
      turns,
      events,
      finalResponse,
      duration,
    }

    console.log('\n场景执行完成!')
    console.log('轮次: ' + turns)
    console.log('耗时: ' + duration + 'ms')

    return result

  } catch (error: any) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    console.error('\n场景执行失败:', errorMessage)

    return {
      scenarioId: scenario.id,
      success: false,
      turns: 0,
      events,
      duration,
      error: errorMessage,
    }
  }
}

function extractFinalResponse(events: any[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type === 'assistant_message' && event.content) {
      return event.content
    }
  }
  return undefined
}

function countTurns(events: any[]): number {
  return events.filter(e => e.type === 'user_message' || e.type === 'assistant_message').length / 2
}

export async function main() {
  const fs = await import('fs/promises')
  const path = await import('path')

  const testDir = path.join(process.cwd(), 'real-agent-test-' + Date.now())
  await fs.mkdir(testDir, { recursive: true })

  console.log('测试目录: ' + testDir)
  console.log('')

  const scenarioId = process.argv[2]

  if (!scenarioId) {
    console.log('请指定场景ID:')
    console.log('  bug-fix-simple')
    console.log('  feature-implementation')
    console.log('')
    console.log('用法: npm run eval:real <scenario-id>')
    process.exit(1)
  }

  const result = await runRealAgentTest(testDir, scenarioId)

  // 生成报告
  const reportPath = path.join(testDir, 'test-report.md')
  const report = generateReport(result)
  await fs.writeFile(reportPath, report, 'utf-8')

  console.log('\n' + '='.repeat(80))
  console.log('测试完成!')
  console.log('='.repeat(80))
  console.log('\n详细报告: ' + reportPath)
}

function generateReport(result: RealTestResult): string {
  const lines: string[] = [
    '='.repeat(80),
    '真实Agent能力测试报告',
    '='.repeat(80),
    '',
    '场景: ' + result.scenarioId,
    '状态: ' + (result.success ? '✓ 成功' : '✗ 失败'),
    '轮次: ' + result.turns,
    '耗时: ' + result.duration + 'ms',
    '',
  ]

  if (result.finalResponse) {
    lines.push('Agent最终响应:')
    lines.push('-'.repeat(80))
    lines.push('')
    lines.push(result.finalResponse)
    lines.push('')
  }

  if (result.error) {
    lines.push('错误信息:')
    lines.push('-'.repeat(80))
    lines.push('')
    lines.push(result.error)
    lines.push('')
  }

  lines.push('='.repeat(80))

  return lines.join('\n')
}

// 运行主函数
main().catch((error) => {
  console.error('错误:', error)
  process.exit(1)
})
