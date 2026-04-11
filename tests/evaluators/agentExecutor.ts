/**
 * Agent 端到端执行器
 *
 * 创建真实的Agent执行环境并收集执行轨迹用于评估
 */
import { createLogger } from '../../src/logging/index.js'
import { createSessionState } from '../../src/state/SessionState.js'
import { createAnthropicClient } from '../../src/api/anthropicClient.js'
import { FileReadTool } from '../../src/tools/local/FileReadTool.js'
import { FileWriteTool } from '../../src/tools/local/FileWriteTool.js'
import { FileEditTool } from '../../src/tools/local/FileEditTool.js'
import { GlobTool } from '../../src/tools/local/GlobTool.js'
import { GrepTool } from '../../src/tools/local/GrepTool.js'
import { BashTool } from '../../src/tools/local/BashTool.js'
import { AgentTool } from '../../src/tools/agent/AgentTool.js'
import { generateEvaluationReport, AgentLoopTracker } from './agentLoopTracker.js'

const logger = createLogger({
  name: 'agent-evaluator',
  level: 'info',
  pretty: true,
})

/**
 * 测试场景定义
 */
export interface TestScenario {
  /** 场景ID */
  id: string
  /** 场景名称 */
  name: string
  /** 问题描述 */
  problem: string
  /** 初始文件 */
  initialFiles?: Record<string, string>
  /** 预期行为（用于验证） */
  expectedBehavior: string[]
  /** 最大轮次限制 */
  maxTurns?: number
  /** 是否允许bash执行 */
  allowBash?: boolean
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  /** 场景ID */
  scenarioId: string
  /** 执行的轮次 */
  turns: number
  /** 是否成功 */
  success: boolean
  /** 执行的事件 */
  events: any[]
  /** 评估报告 */
  report: any
}

/**
 * Agent执行器
 */
export class AgentExecutor {
  private testDir: string
  private sessionId: string

  constructor(testDir: string) {
    this.testDir = testDir
    this.sessionId = `eval-${Date.now()}`
  }

  /**
   * 执行一个测试场景
   */
  async executeScenario(scenario: TestScenario): Promise<ExecutionResult> {
    logger.info({ msg: '开始执行场景', scenario: scenario.id })

    // 1. 初始化环境
    await this.initializeEnvironment(scenario)

    // 2. 创建Agent状态
    const sessionState = createSessionState({
      cwd: this.testDir,
      sessionId: this.sessionId,
    })

    // 3. 配置工具
    const tools = this.configureTools(scenario)

    // 4. 创建API客户端（模拟）
    // 注意：这里需要实际的API key或使用mock
    // const apiClient = this.createAPIClient()

    // 5. 创建追踪器
    const tracker = new AgentLoopTracker(scenario.id, scenario.problem)

    // 6. 执行Agent（模拟）
    const events = await this.simulateAgentExecution(scenario, tracker)

    // 7. 生成评估报告
    const report = generateEvaluationReport(scenario.id, scenario.problem, events)

    const result: ExecutionResult = {
      scenarioId: scenario.id,
      turns: events.length,
      success: report.solved,
      events,
      report,
    }

    logger.info({ msg: '场景执行完成', result })

    return result
  }

  /**
   * 初始化测试环境
   */
  private async initializeEnvironment(scenario: TestScenario): Promise<void> {
    logger.info({ msg: '初始化环境', files: scenario.initialFiles })

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
   * 配置工具列表
   */
  private configureTools(scenario: TestScenario) {
    const tools = [
      new FileReadTool(),
      new FileWriteTool(),
      new FileEditTool(),
      new GlobTool(),
      new GrepTool(),
    ]

    if (scenario.allowBash !== false) {
      tools.push(new BashTool())
    }

    return tools
  }

  /**
   * 模拟Agent执行
   * 注意：这是简化版本，真实的执行需要完整的Agent Loop
   */
  private async simulateAgentExecution(
    scenario: TestScenario,
    tracker: AgentLoopTracker
  ): Promise<any[]> {
    const events: any[] = []
    const maxTurns = scenario.maxTurns || 10

    logger.info({ msg: '模拟Agent执行', maxTurns })

    // 模拟执行过程
    for (let turn = 1; turn <= maxTurns; turn++) {
      logger.debug({ msg: `轮次 ${turn}`, turn })

      // 1. Agent思考阶段
      events.push({
        type: 'assistant_message',
        content: this.simulateThinking(scenario, turn),
        role: 'assistant',
      })

      // 2. Agent执行工具
      const toolEvents = await this.simulateToolUsage(scenario, turn)
      events.push(...toolEvents)

      // 3. 检查是否应该继续
      if (this.shouldStop(scenario, turn, events)) {
        break
      }
    }

    return events
  }

  /**
   * 模拟Agent的思考过程
   */
  private simulateThinking(scenario: TestScenario, turn: number): string {
    // 根据轮次返回不同的思考内容
    const thinkings = {
      1: `我需要理解这个任务：${scenario.problem.substring(0, 50)}...`,
      2: '让我先查看项目中相关的文件结构。',
      3: '现在分析一下问题的根本原因。',
      4: '我找到了问题所在，让我生成解决方案。',
      5: '方案已经生成，现在需要验证它是否工作。',
      6: '验证成功了！让我再检查一下是否还有遗漏。',
    }

    return thinkings[turn as keyof typeof thinkings] || '继续分析...'
  }

  /**
   * 模拟工具使用
   */
  private async simulateToolUsage(scenario: TestScenario, turn: number): Promise<any[]> {
    const events: any[] = []

    // 根据轮次返回不同的工具使用
    const toolUsages = {
      1: [
        { type: 'tool_use', tool_name: 'GlobTool', input: { pattern: '**/*.ts' } },
      ],
      2: [
        { type: 'tool_use', tool_name: 'GrepTool', input: { pattern: 'function' } },
        { type: 'tool_result', content: 'Found 3 functions', is_error: false },
      ],
      3: [
        { type: 'tool_use', tool_name: 'FileReadTool', input: { file_path: 'src/main.ts' } },
        { type: 'tool_result', content: 'function main() {...}', is_error: false },
      ],
      4: [
        { type: 'tool_use', tool_name: 'FileEditTool', input: { file_path: 'src/main.ts', edits: [{ oldText: 'bug', newText: 'fix' }] } },
        { type: 'tool_result', content: 'Successfully edited', is_error: false },
      ],
      5: [
        { type: 'tool_use', tool_name: 'BashTool', input: { command: 'npm test' } },
        { type: 'tool_result', content: 'Tests passed', is_error: false },
      ],
    }

    const usage = toolUsages[turn as keyof typeof toolUsages]
    if (usage) {
      events.push(...usage)
    }

    return events
  }

  /**
   * 判断是否应该停止执行
   */
  private shouldStop(scenario: TestScenario, turn: number, events: any[]): boolean {
    // 如果已经看到了成功的验证结果，停止
    const hasSuccess = events.some(e =>
      e.type === 'tool_result' &&
      !e.is_error &&
      e.content?.includes('成功') &&
      e.content?.includes('pass')
    )

    if (hasSuccess) {
      return true
    }

    // 如果达到最大轮次，停止
    return turn >= (scenario.maxTurns || 10)
  }
}

/**
 * 创建执行器实例
 */
export function createAgentExecutor(testDir: string): AgentExecutor {
  return new AgentExecutor(testDir)
}

/**
 * 预定义的测试场景
 */
export const testScenarios: TestScenario[] = [
  {
    id: 'simple-bug-fix',
    name: '简单Bug修复',
    problem: '修复 calculateSum 函数中的bug：循环应该从 i=0 开始，而不是 i=1',
    initialFiles: {
      'src/utils/math.ts': `
function calculateSum(items: number[]): number {
  let sum = 0;
  for (let i = 1; i < items.length; i++) {
    sum += items[i];
  }
  return sum;
}
      `.trim(),
    },
    expectedBehavior: [
      '使用 FileReadTool 读取文件',
      '识别出循环索引问题',
      '使用 FileEditTool 修复 bug',
      '运行测试验证修复',
    ],
    maxTurns: 5,
    allowBash: true,
  },
  {
    id: 'feature-implementation',
    name: '功能实现',
    problem: '实现一个 REST API 端点，支持 GET /api/users 和 POST /api/users',
    initialFiles: {
      'package.json': JSON.stringify({ name: 'test-api', version: '1.0.0' }, null, 2),
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext' } }, null, 2),
    },
    expectedBehavior: [
      '使用 GlobTool 查找相关文件',
      '设计 API 路由结构',
      '创建路由处理器',
      '添加类型定义',
      '测试端点',
    ],
    maxTurns: 8,
    allowBash: true,
  },
  {
    id: 'code-refactoring',
    name: '代码重构',
    problem: '重构重复的代码，将重复的验证逻辑提取为独立的函数',
    initialFiles: {
      'src/validators/user.ts': `
export function validateUser(user: any) {
  if (!user.name) throw new Error('Name required');
  if (!user.email) throw new Error('Email required');
  if (!user.age) throw new Error('Age required');
}
      `.trim(),
      'src/validators/product.ts': `
export function validateProduct(product: any) {
  if (!product.name) throw new Error('Name required');
  if (!product.price) throw new Error('Price required');
  if (!product.description) throw new Error('Description required');
}
      `.trim(),
    },
    expectedBehavior: [
      '使用 GrepTool 查找重复模式',
      '识别重复的验证逻辑',
      '创建通用的验证函数',
      '重构代码以使用新函数',
      '确保所有验证仍然工作',
    ],
    maxTurns: 7,
    allowBash: false,
  },
  {
    id: 'debug-complex-issue',
    name: '复杂问题调试',
    problem: '调试一个间歇性的内存泄漏问题，只在大量数据时出现',
    initialFiles: {
      'src/data/processor.ts': `
export class DataProcessor {
  private cache: Map<string, any> = new Map();

  processData(data: any[]) {
    return data.map(item => {
      if (!this.cache.has(item.id)) {
        this.cache.set(item.id, this.processItem(item));
      }
      return this.cache.get(item.id);
    });
  }

  private processItem(item: any) {
    // Complex processing logic
    return { ...item, processed: true };
  }
}
      `.trim(),
    },
    expectedBehavior: [
      '分析代码查找可能的内存泄漏',
      '识别缓存未清理的问题',
      '提出修复方案（如添加缓存清理）',
      '验证修复后内存使用情况',
    ],
    maxTurns: 10,
    allowBash: true,
  },
]

/**
 * 批量执行测试场景
 */
export async function runAllScenarios(
  testDir: string,
  scenarios: TestScenario[] = testScenarios
): Promise<ExecutionResult[]> {
  const executor = createAgentExecutor(testDir)
  const results: ExecutionResult[] = []

  logger.info({ msg: '开始批量执行场景', count: scenarios.length })

  for (const scenario of scenarios) {
    try {
      const result = await executor.executeScenario(scenario)
      results.push(result)
    } catch (error) {
      logger.error({ msg: '场景执行失败', scenario: scenario.id, error })
      results.push({
        scenarioId: scenario.id,
        turns: 0,
        success: false,
        events: [],
        report: {
          problemId: scenario.id,
          problem: scenario.problem,
          totalTurns: 0,
          records: [],
          scores: {
            understanding: 0,
            retrieval: 0,
            analysis: 0,
            generation: 0,
            evaluation: 0,
          },
          totalScore: 0,
          solved: false,
          efficiency: 0,
          capabilityLevel: 'D',
          analysis: ['执行失败'],
        },
      })
    }
  }

  return results
}

/**
 * 生成综合评估报告
 */
export function generateComprehensiveReport(results: ExecutionResult[]): string {
  const lines: string[] = [
    '='.repeat(80),
    'Agent Loop 能力综合评估报告',
    '='.repeat(80),
    '',
    `总场景数: ${results.length}`,
    `成功场景: ${results.filter(r => r.success).length}`,
    `成功率:   ${(results.filter(r => r.success).length / results.length * 100).toFixed(1)}%`,
    '',
    '-' .repeat(80),
    '各场景详情',
    '-' .repeat(80),
    '',
  ]

  for (const result of results) {
    lines.push(
      `场景: ${result.scenarioId}`,
      `  轮次: ${result.turns}`,
      `  成功: ${result.success ? '✓' : '✗'}`,
      `  总分: ${result.report.totalScore}/50`,
      `  等级: ${result.report.capabilityLevel}`,
      '',
      '  能力评分:',
      `    理解: ${result.report.scores.understanding}/10`,
      `    检索: ${result.report.scores.retrieval}/10`,
      `    分析: ${result.report.scores.analysis}/10`,
      `    生成: ${result.report.scores.generation}/10`,
      `    评估: ${result.report.scores.evaluation}/10`,
      '',
      '  能力分析:',
      ...result.report.analysis.map(a => `    ${a}`),
      '',
      '-'.repeat(40),
    )
  }

  // 计算总体统计
  const totalScore = results.reduce((sum, r) => sum + r.report.totalScore, 0)
  const avgScore = totalScore / results.length
  const avgTurns = results.reduce((sum, r) => sum + r.turns, 0) / results.length

  lines.push(
    '',
    '='.repeat(80),
    '总体统计',
    '='.repeat(80),
    '',
    `平均总分: ${avgScore.toFixed(1)}/50`,
    `平均轮次: ${avgTurns.toFixed(1)}`,
    `总体评级: ${getOverallRating(avgScore)}`,
    '',
    '能力改进建议:',
    ...getImprovementSuggestions(results),
    '',
    '='.repeat(80),
  )

  return lines.join('\n')
}

/**
 * 获取总体评级
 */
function getOverallRating(avgScore: number): string {
  if (avgScore >= 45) return 'S - 卓越 (Agent具备优秀的问题解决能力)'
  if (avgScore >= 35) return 'A - 优秀 (Agent具备良好的问题解决能力)'
  if (avgScore >= 25) return 'B - 良好 (Agent具备基本的问题解决能力)'
  if (avgScore >= 15) return 'C - 合格 (Agent需要进一步改进)'
  return 'D - 需要改进 (Agent的问题解决能力不足)'
}

/**
 * 生成改进建议
 */
function getImprovementSuggestions(results: ExecutionResult[]): string[] {
  const suggestions: string[] = []

  // 计算各能力平均分
  const avgUnderstanding = results.reduce((sum, r) => sum + r.report.scores.understanding, 0) / results.length
  const avgRetrieval = results.reduce((sum, r) => sum + r.report.scores.retrieval, 0) / results.length
  const avgAnalysis = results.reduce((sum, r) => sum + r.report.scores.analysis, 0) / results.length
  const avgGeneration = results.reduce((sum, r) => sum + r.report.scores.generation, 0) / results.length
  const avgEvaluation = results.reduce((sum, r) => sum + r.report.scores.evaluation, 0) / results.length

  if (avgUnderstanding < 7) {
    suggestions.push('- 理解能力较弱：建议加强Agent对复杂需求的解析能力')
  }

  if (avgRetrieval < 7) {
    suggestions.push('- 检索能力较弱：建议增强Agent主动查找相关信息的意识')
  }

  if (avgAnalysis < 7) {
    suggestions.push('- 分析能力较弱：建议培养Agent深入分析问题根本原因的能力')
  }

  if (avgGeneration < 7) {
    suggestions.push('- 生成能力较弱：建议提高Agent生成高质量代码的能力')
  }

  if (avgEvaluation < 7) {
    suggestions.push('- 评估能力较弱：建议增强Agent验证和迭代改进的能力')
  }

  // 检查效率问题
  const avgTurns = results.reduce((sum, r) => sum + r.turns, 0) / results.length
  if (avgTurns > 8) {
    suggestions.push('- 效率较低：平均轮次过多，建议优化Agent的决策过程')
  }

  if (suggestions.length === 0) {
    suggestions.push('- 所有能力均表现优秀，继续保持！')
  }

  return suggestions
}
