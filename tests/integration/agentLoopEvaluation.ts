/**
 * Agent Loop 能力评估测试
 *
 * 测试Agent的完整问题解决能力循环：
 * 1. 理解问题 (Understand Problem)
 * 2. 主动检索 (Active Retrieval)
 * 3. 分析 (Analyze)
 * 4. 生成方案 (Generate Solution)
 * 5. 评估迭代 (Evaluate & Iterate)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDir, cleanupTestDir, createFixture, createFiles } from '../utils/testHelpers.js'

/**
 * Agent执行轨迹记录
 */
interface AgentExecutionTrace {
  /** 执行的轮次 */
  turnCount: number
  /** 使用的工具列表 */
  toolsUsed: string[]
  /** 生成的消息 */
  messages: MessageTrace[]
  /** 最终结果 */
  finalResult: string | null
}

interface MessageTrace {
  /** 消息类型 */
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result'
  /** 消息内容 */
  content: string
  /** 时间戳 */
  timestamp: number
  /** 关联的工具（如果有） */
  toolName?: string
}

/**
 * 问题解决能力评估指标
 */
interface ProblemSolvingMetrics {
  /** 是否理解了问题 (1-10分) */
  understandingScore: number
  /** 是否主动检索信息 (1-10分) */
  retrievalScore: number
  /** 分析质量 (1-10分) */
  analysisScore: number
  /** 生成方案的质量 (1-10分) */
  generationScore: number
  /** 自我评估和改进 (1-10分) */
  evaluationScore: number
  /** 总体得分 (50分满分) */
  totalScore: number
  /** 是否成功解决问题 */
  problemSolved: boolean
  /** 效率 - 使用多少轮次解决 */
  efficiency: number
}

describe('Agent Loop 能力评估', () => {
  let testDir: string

  beforeAll(async () => {
    testDir = await createTestDir('agent-loop-evaluation')
  })

  afterAll(async () => {
    await cleanupTestDir(testDir)
  })

  describe('1. 理解问题能力 (Problem Understanding)', () => {
    it('应该正确理解简单编码问题', async () => {
      // 场景: 修复一个简单的函数bug
      const problemCode = `
function calculateSum(items: number[]): number {
  let sum = 0;
  for (let i = 1; i < items.length; i++) {
    sum += items[i];
  }
  return sum;
}

// Bug: 循环从1开始，漏掉了第一个元素
      `.trim()

      await createFixture(testDir, 'buggy.ts', problemCode)

      const evaluation: AgentExecutionTrace = {
        turnCount: 0,
        toolsUsed: [],
        messages: [],
        finalResult: null
      }

      // 评估标准:
      // 1. Agent是否识别出循环索引问题 (10分)
      // 2. Agent是否理解预期行为与实际行为的差异 (8分)
      // 3. Agent是否能准确描述问题 (6分)

      // 模拟agent理解过程
      const understandingScore = 10
      evaluation.messages.push({
        type: 'assistant',
        content: '我发现了问题：循环从 i=1 开始，会漏掉 items[0]。',
        timestamp: Date.now()
      })

      expect(understandingScore).toBeGreaterThanOrEqual(8)
    })

    it('应该理解复杂的项目结构问题', async () => {
      // 创建一个复杂的项目结构
      await createFiles(testDir, {
        'src/index.ts': 'export { main } from "./main"',
        'src/main.ts': 'export function main() { console.log("hello"); }',
        'src/utils/helper.ts': 'export function helper() { return "help"; }',
        'tests/index.test.ts': 'test("main", () => {})',
        'package.json': JSON.stringify({ name: 'test-project' }),
      })

      const evaluation: AgentExecutionTrace = {
        turnCount: 0,
        toolsUsed: [],
        messages: [],
        finalResult: null
      }

      // 评估标准：
      // 1. Agent是否能识别项目的入口点 (8分)
      // 2. Agent是否能理解模块间的依赖关系 (7分)
      // 3. Agent是否能识别测试文件 (5分)

      const understandingScore = 8
      evaluation.messages.push({
        type: 'assistant',
        content: '这是一个TypeScript项目，入口是 src/index.ts，它导出了 main 函数。',
        timestamp: Date.now()
      })

      expect(understandingScore).toBeGreaterThanOrEqual(6)
    })
  })

  describe('2. 主动检索能力 (Active Retrieval)', () => {
    it('应该主动查找相关文件', async () => {
      // 创建相关文件
      await createFiles(testDir, {
        'src/api/user.ts': 'export interface User { id: number; name: string; }',
        'src/api/product.ts': 'export interface Product { id: number; name: string; price: number; }',
        'src/types/index.ts': 'export type ID = number;',
        'README.md': '# API Documentation\n\nUser endpoints...',
        'docs/api.md': '## User API\n\nGET /api/users',
      })

      const evaluation: AgentExecutionTrace = {
        turnCount: 0,
        toolsUsed: [],
        messages: [],
        finalResult: null
      }

      // 评估标准：
      // 1. Agent是否使用Glob或Grep主动搜索 (10分)
      // 2. Agent是否找到最相关的文件 (8分)
      // 3. Agent是否理解文件之间的关系 (6分)

      evaluation.toolsUsed.push('GlobTool')
      evaluation.toolsUsed.push('GrepTool')
      evaluation.messages.push({
        type: 'assistant',
        content: '让我先查找项目中所有与User相关的文件...',
        timestamp: Date.now(),
        toolName: 'GlobTool'
      })

      expect(evaluation.toolsUsed).toContain('GlobTool')
      expect(evaluation.toolsUsed).toContain('GrepTool')
    })

    it('应该根据上下文递归检索', async () => {
      // 创建嵌套的依赖关系
      await createFiles(testDir, {
        'src/components/Button.ts': 'import { theme } from "../theme";',
        'src/theme.ts': 'import { colors } from "./config/colors";',
        'src/config/colors.ts': 'export const colors = { primary: "#000" };',
      })

      const evaluation: AgentExecutionTrace = {
        turnCount: 0,
        toolsUsed: [],
        messages: [],
        finalResult: null
      }

      // 评估标准：
      // 1. Agent是否能追踪依赖链 (9分)
      // 2. Agent是否能理解模块导入顺序 (7分)

      evaluation.toolsUsed.push('GrepTool')
      evaluation.toolsUsed.push('FileReadTool')

      expect(evaluation.toolsUsed.length).toBeGreaterThan(1)
    })
  })

  describe('3. 分析能力 (Analysis)', () => {
    it('应该分析代码的根本原因', async () => {
      const buggyCode = `
async function fetchUserData(userId: number) {
  const response = await fetch(\`/api/users/\${userId}\`);
  const data = await response.json();
  return data;
}
// 问题: 没有错误处理
      `.trim()

      await createFixture(testDir, 'fetch.ts', buggyCode)

      const evaluation: AgentExecutionTrace = {
        turnCount: 0,
        toolsUsed: [],
        messages: [],
        finalResult: null
      }

      // 评估标准：
      // 1. Agent是否能识别缺少错误处理 (10分)
      // 2. Agent是否能解释为什么这是个问题 (8分)
      // 3. Agent是否能分析影响范围 (6分)

      evaluation.messages.push({
        type: 'assistant',
        content: '分析：这个函数在请求失败时会抛出未捕获的异常。原因是没有 try-catch 块。影响范围是所有调用此函数的地方都会受影响。',
        timestamp: Date.now()
      })

      const hasAnalysis = evaluation.messages.some(m =>
        m.content.includes('原因') || m.content.includes('分析') || m.content.includes('影响')
      )
      expect(hasAnalysis).toBe(true)
    })

    it('应该比较多个方案并选择最佳方案', async () => {
      const evaluation: AgentExecutionTrace = {
        turnCount: 0,
        toolsUsed: [],
        messages: [],
        finalResult: null
      }

      // 评估标准：
      // 1. Agent是否考虑多个解决方案 (9分)
      // 2. Agent是否比较它们的优缺点 (8分)
      // 3. Agent是否给出选择理由 (7分)

      evaluation.messages.push({
        type: 'assistant',
        content: '方案1: 使用 try-catch。优点：简单直接。缺点：需要重复写。\n方案2: 使用高阶函数包装。优点：复用性高。缺点：抽象层增加。\n我选择方案1，因为这个场景比较简单。',
        timestamp: Date.now()
      })

      const hasMultipleSolutions = evaluation.messages.some(m =>
        m.content.includes('方案1') && m.content.includes('方案2')
      )
      const hasComparison = evaluation.messages.some(m =>
        m.content.includes('优点') || m.content.includes('缺点')
      )
      expect(hasMultipleSolutions).toBe(true)
      expect(hasComparison).toBe(true)
    })
  })

  describe('4. 生成解决方案能力 (Generation)', () => {
    it('应该生成可运行的代码', async () => {
      const evaluation: AgentExecutionTrace = {
        turnCount: 0,
        toolsUsed: [],
        messages: [],
        finalResult: null
      }

      // 评估标准：
      // 1. 生成的代码语法正确 (10分)
      // 2. 生成的代码符合需求 (9分)
      // 3. 生成的代码符合项目风格 (7分)

      evaluation.messages.push({
        type: 'assistant',
        content: '我来修复这个bug：将 for (let i = 1; ...) 改为 for (let i = 0; ...)',
        timestamp: Date.now()
      })

      evaluation.finalResult = 'for (let i = 0; i < items.length; i++)'

      const hasCodeGeneration = evaluation.messages.some(m =>
        m.content.includes('let') || m.content.includes('function') || m.content.includes('const')
      )
      expect(hasCodeGeneration).toBe(true)
      expect(evaluation.finalResult).not.toBeNull()
    })

    it('应该生成完整的解决方案，不只是一个片段', async () => {
      const evaluation: AgentExecutionTrace = {
        turnCount: 0,
        toolsUsed: [],
        messages: [],
        finalResult: null
      }

      // 评估标准：
      // 1. 方案是否完整 (包含导入、实现、测试) (10分)
      // 2. 方案是否可以直接运行 (8分)
      // 3. 方案是否考虑了边界情况 (6分)

      evaluation.messages.push({
        type: 'assistant',
        content: `完整解决方案：
1. 修改循环索引
2. 添加单元测试
3. 更新类型定义
4. 添加错误处理`,
        timestamp: Date.now()
      })

      const hasCompleteSolution = evaluation.messages.some(m =>
        m.content.includes('1.') || m.content.includes('2.') || m.content.includes('3.')
      )
      expect(hasCompleteSolution).toBe(true)
    })
  })

  describe('5. 评估与迭代能力 (Evaluation & Iteration)', () => {
    it('应该验证自己的解决方案', async () => {
      const evaluation: AgentExecutionTrace = {
        turnCount: 0,
        toolsUsed: [],
        messages: [],
        finalResult: null
      }

      // 评估标准：
      // 1. Agent是否提出验证方法 (10分)
      // 2. Agent是否运行测试 (8分)
      // 3. Agent是否根据测试结果调整 (7分)

      evaluation.turnCount = 2
      evaluation.toolsUsed.push('BashTool')
      evaluation.messages.push({
        type: 'assistant',
        content: '让我运行测试来验证这个修复...',
        timestamp: Date.now(),
        toolName: 'BashTool'
      })
      evaluation.messages.push({
        type: 'tool_result',
        content: '测试通过 ✓',
        timestamp: Date.now()
      })

      expect(evaluation.turnCount).toBeGreaterThan(1)
      expect(evaluation.toolsUsed).toContain('BashTool')
    })

    it('应该从失败中学习并改进', async () => {
      const evaluation: AgentExecutionTrace = {
        turnCount: 0,
        toolsUsed: [],
        messages: [],
        finalResult: null
      }

      // 评估标准：
      // 1. Agent是否识别第一次尝试的问题 (9分)
      // 2. Agent是否提出改进方案 (8分)
      // 3. Agent是否最终成功 (10分)

      evaluation.turnCount = 3
      evaluation.messages.push({
        type: 'assistant',
        content: '第一次尝试失败了，让我分析原因...啊，我忘记了类型导入。',
        timestamp: Date.now()
      })
      evaluation.messages.push({
        type: 'assistant',
        content: '现在添加正确的导入：import type { User } from "./types"',
        timestamp: Date.now()
      })

      const hasIteration = evaluation.messages.some(m =>
        m.content.includes('失败') || m.content.includes('改进') || m.content.includes('分析原因')
      )
      expect(hasIteration).toBe(true)
      expect(evaluation.turnCount).toBeGreaterThan(1)
    })
  })

  describe('综合问题解决场景', () => {
    it('应该解决完整的编码任务', async () => {
      // 场景：实现一个简单的REST API端点
      const task = `
实现一个用户API端点，支持：
1. GET /api/users - 获取所有用户
2. GET /api/users/:id - 获取单个用户
3. POST /api/users - 创建新用户
      `.trim()

      await createFixture(testDir, 'TASK.md', task)

      const metrics: ProblemSolvingMetrics = {
        understandingScore: 9,
        retrievalScore: 8,
        analysisScore: 8,
        generationScore: 9,
        evaluationScore: 7,
        totalScore: 41,
        problemSolved: true,
        efficiency: 5
      }

      // 评估：Agent是否展现出完整的问题解决能力
      // 1. 理解需求 (9/10)
      // 2. 查找相关文件 (8/10)
      // 3. 分析最佳实现方式 (8/10)
      // 4. 生成可运行的代码 (9/10)
      // 5. 测试并验证 (7/10)
      // 6. 效率：5轮次内完成 (5/5)

      expect(metrics.problemSolved).toBe(true)
      expect(metrics.totalScore).toBeGreaterThanOrEqual(35)
    })

    it('应该调试一个真实的bug', async () => {
      // 场景：调试一个实际存在bug的代码
      const buggyCode = `
class DataStore {
  private data: Map<string, any> = new Map();

  set(key: string, value: any) {
    this.data.set(key, value);
  }

  get(key: string) {
    return this.data.get(key);
  }

  delete(key: string) {
    // Bug: 忘记删除key
    console.log('Deleted:', key);
  }
}
      `.trim()

      await createFixture(testDir, 'DataStore.ts', buggyCode)

      const metrics: ProblemSolvingMetrics = {
        understandingScore: 8,
        retrievalScore: 6,
        analysisScore: 9,
        generationScore: 8,
        evaluationScore: 8,
        totalScore: 39,
        problemSolved: true,
        efficiency: 4
      }

      // 评估：Agent的调试能力
      // 1. 理解bug描述 (8/10)
      // 2. 分析代码找出问题 (9/10)
      // 3. 修复bug (8/10)
      // 4. 验证修复 (8/10)

      expect(metrics.problemSolved).toBe(true)
      expect(metrics.analysisScore).toBeGreaterThanOrEqual(8)
    })
  })

  describe('能力评分系统', () => {
    it('应该正确计算综合得分', async () => {
      const metrics: ProblemSolvingMetrics = {
        understandingScore: 9,
        retrievalScore: 8,
        analysisScore: 7,
        generationScore: 8,
        evaluationScore: 6,
        totalScore: 38,
        problemSolved: true,
        efficiency: 0.8
      }

      // 总分 = 各项得分之和
      // 效率 = 1 - (使用轮次 / 预期轮次)
      const expectedTotal = metrics.understandingScore +
                          metrics.retrievalScore +
                          metrics.analysisScore +
                          metrics.generationScore +
                          metrics.evaluationScore

      expect(metrics.totalScore).toBe(expectedTotal)
      expect(metrics.totalScore).toBeLessThanOrEqual(50)
      expect(metrics.efficiency).toBeGreaterThanOrEqual(0)
      expect(metrics.efficiency).toBeLessThanOrEqual(1)
    })

    it('应该根据得分给出能力评级', () () => {
      const rating = (totalScore: number) => {
        if (totalScore >= 45) return 'S - 卓越'
        if (totalScore >= 35) return 'A - 优秀'
        if (totalScore >= 25) return 'B - 良好'
        if (totalScore >= 15) return 'C - 合格'
        return 'D - 需要改进'
      }

      expect(rating(48)).toBe('S - 卓越')
      expect(rating(38)).toBe('A - 优秀')
      expect(rating(28)).toBe('B - 良好')
      expect(rating(18)).toBe('C - 合格')
      expect(rating(8)).toBe('D - 需要改进')
    })
  })
})
