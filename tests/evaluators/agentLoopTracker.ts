/**
 * Agent Loop 执行追踪器
 *
 * 用于追踪和评估Agent在问题解决过程中的完整能力
 */
import type { StreamEvent } from '../../src/types.js'

/**
 * Agent执行阶段
 */
export enum AgentPhase {
  UNDERSTAND = 'understand',      // 理解问题
  RETRIEVE = 'retrieve',        // 主动检索
  ANALYZE = 'analyze',          // 分析问题
  GENERATE = 'generate',          // 生成方案
  EVALUATE = 'evaluate',        // 评估验证
  ITERATE = 'iterate',           // 迭代改进
}

/**
 * Agent执行动作
 */
export enum AgentAction {
  READ_FILE = 'read_file',
  WRITE_FILE = 'write_file',
  EDIT_FILE = 'edit_file',
  GLOB_SEARCH = 'glob_search',
  GREP_SEARCH = 'grep_search',
  BASH_EXECUTE = 'bash_execute',
  THINKING = 'thinking',
  REFLECTION = 'reflection',
}

/**
 * 执行追踪记录
 */
export interface ExecutionRecord {
  /** 轮次编号 */
  turn: number
  /** 执行阶段 */
  phase: AgentPhase
  /** 执行动作 */
  action: AgentAction
  /** 动作内容 */
  content: string
  /** 时间戳 */
  timestamp: number
  /** 是否成功 */
  success?: boolean
  /** 错误信息（如果有） */
  error?: string
}

/**
 * 问题解决评估报告
 */
export interface ProblemSolvingReport {
  /** 问题ID */
  problemId: string
  /** 问题描述 */
  problem: string
  /** 总轮次 */
  totalTurns: number
  /** 执行记录 */
  records: ExecutionRecord[]
  /** 能力评分 */
  scores: {
    understanding: number      // 理解能力 (0-10)
    retrieval: number         // 检索能力 (0-10)
    analysis: number           // 分析能力 (0-10)
    generation: number         // 生成能力 (0-10)
    evaluation: number        // 评估能力 (0-10)
  }
  /** 总分 */
  totalScore: number
  /** 是否解决 */
  solved: boolean
  /** 效率评分 */
  efficiency: number
  /** 能力等级 */
  capabilityLevel: 'S' | 'A' | 'B' | 'C' | 'D'
  /** 详细分析 */
  analysis: string[]
}

/**
 * Agent Loop 追踪器
 */
export class AgentLoopTracker {
  private problemId: string
  private problem: string
  private records: ExecutionRecord[] = []
  private currentTurn: number = 0
  private currentPhase: AgentPhase = AgentPhase.UNDERSTAND

  constructor(problemId: string, problem: string) {
    this.problemId = problemId
    this.problem = problem
  }

  /**
   * 记录一个执行动作
   */
  record(action: AgentAction, content: string, success = true, error?: string): void {
    const record: ExecutionRecord = {
      turn: this.currentTurn,
      phase: this.currentPhase,
      action,
      content,
      timestamp: Date.now(),
      success,
      error,
    }

    this.records.push(record)
  }

  /**
   * 进入新轮次
   */
  nextTurn(): void {
    this.currentTurn++
  }

  /**
   * 切换阶段
   */
  setPhase(phase: AgentPhase): void {
    this.currentPhase = phase
  }

  /**
   * 获取所有记录
   */
  getRecords(): ExecutionRecord[] {
    return [...this.records]
  }

  /**
   * 获取指定阶段的记录
   */
  getRecordsByPhase(phase: AgentPhase): ExecutionRecord[] {
    return this.records.filter(r => r.phase === phase)
  }

  /**
   * 获取指定动作的记录
   */
  getRecordsByAction(action: AgentAction): ExecutionRecord[] {
    return this.records.filter(r => r.action === action)
  }

  /**
   * 生成评估报告
   */
  generateReport(): ProblemSolvingReport {
    const totalTurns = this.currentTurn

    // 1. 评估理解能力
    const understandingScore = this.evaluateUnderstanding()

    // 2. 评估检索能力
    const retrievalScore = this.evaluateRetrieval()

    // 3. 评估分析能力
    const analysisScore = this.evaluateAnalysis()

    // 4. 评估生成能力
    const generationScore = this.evaluateGeneration()

    // 5. 评估评估能力
    const evaluationScore = this.evaluateEvaluation()

    const totalScore = understandingScore + retrievalScore +
                        analysisScore + generationScore +
                        evaluationScore

    const solved = this.isProblemSolved()
    const efficiency = this.calculateEfficiency(totalTurns)
    const capabilityLevel = this.getCapabilityLevel(totalScore)

    const analysis = this.generateAnalysis({
      understandingScore,
      retrievalScore,
      analysisScore,
      generationScore,
      evaluationScore,
      totalScore,
      solved,
      efficiency,
    })

    return {
      problemId: this.problemId,
      problem: this.problem,
      totalTurns,
      records: this.records,
      scores: {
        understanding: understandingScore,
        retrieval: retrievalScore,
        analysis: analysisScore,
        generation: generationScore,
        evaluation: evaluationScore,
      },
      totalScore,
      solved,
      efficiency,
      capabilityLevel,
      analysis,
    }
  }

  /**
   * 评估理解能力 (0-10分)
   */
  private evaluateUnderstanding(): number {
    let score = 0
    const understandRecords = this.getRecordsByPhase(AgentPhase.UNDERSTAND)

    // 是否有理解相关的思考 (4分)
    const hasThinking = understandRecords.some(r =>
      r.action === AgentAction.THINKING
    )
    if (hasThinking) score += 4

    // 是否正确识别了问题 (3分)
    const hasProblemIdentification = understandRecords.some(r =>
      r.content.toLowerCase().includes('问题') ||
      r.content.toLowerCase().includes('bug') ||
      r.content.toLowerCase().includes('错误')
    )
    if (hasProblemIdentification) score += 3

    // 理解是否准确 (3分)
    const hasAccurateUnderstanding = understandRecords.some(r =>
      r.content.length > 50 && r.content.length < 500
    )
    if (hasAccurateUnderstanding) score += 3

    return Math.min(score, 10)
  }

  /**
   * 评估检索能力 (0-10分)
   */
  private evaluateRetrieval(): number {
    let score = 0
    const retrieveRecords = this.getRecordsByPhase(AgentPhase.RETRIEVE)

    // 是否使用了搜索工具 (4分)
    const hasSearch = retrieveRecords.some(r =>
      r.action === AgentAction.GLOB_SEARCH ||
      r.action === AgentAction.GREP_SEARCH
    )
    if (hasSearch) score += 4

    // 是否阅读了相关文件 (3分)
    const hasFileRead = retrieveRecords.some(r =>
      r.action === AgentAction.READ_FILE && r.success
    )
    if (hasFileRead) score += 3

    // 检索是否有针对性 (3分)
    const targetedSearch = retrieveRecords.filter(r =>
      r.action === AgentAction.GLOB_SEARCH || r.action === AgentAction.GREP_SEARCH
    )
    if (targetedSearch.length >= 2) score += 3

    return Math.min(score, 10)
  }

  /**
   * 评估分析能力 (0-10分)
   */
  private evaluateAnalysis(): number {
    let score = 0
    const analyzeRecords = this.getRecordsByPhase(AgentPhase.ANALYZE)

    // 是否有分析相关的思考 (3分)
    const hasAnalysisThinking = analyzeRecords.some(r =>
      r.action === AgentAction.THINKING &&
      (r.content.includes('分析') ||
       r.content.includes('原因') ||
       r.content.includes('因为'))
    )
    if (hasAnalysisThinking) score += 3

    // 是否比较了多个方案 (4分)
    const hasMultipleOptions = analyzeRecords.some(r =>
      r.content.includes('方案1') ||
      r.content.includes('选项1') ||
      r.content.includes('或者')
    )
    if (hasMultipleOptions) score += 4

    // 分析是否有逻辑性 (3分)
    const hasLogicalAnalysis = analyzeRecords.some(r =>
      r.content.length > 100 &&
      r.content.includes('因为') &&
      r.content.includes('所以')
    )
    if (hasLogicalAnalysis) score += 3

    return Math.min(score, 10)
  }

  /**
   * 评估生成能力 (0-10分)
   */
  private evaluateGeneration(): number {
    let score = 0
    const generateRecords = this.getRecordsByPhase(AgentPhase.GENERATE)

    // 是否生成了代码 (4分)
    const hasCodeGen = generateRecords.some(r =>
      r.action === AgentAction.WRITE_FILE ||
      r.action === AgentAction.EDIT_FILE
    )
    if (hasCodeGen) score += 4

    // 生成是否成功 (3分)
    const successfulGen = generateRecords.filter(r =>
      (r.action === AgentAction.WRITE_FILE ||
       r.action === AgentAction.EDIT_FILE) &&
      r.success
    )
    if (successfulGen.length > 0) score += 3

    // 生成是否完整 (3分)
    const hasCompleteGen = generateRecords.some(r =>
      r.action === AgentAction.WRITE_FILE &&
      r.content.length > 100
    )
    if (hasCompleteGen) score += 3

    return Math.min(score, 10)
  }

  /**
   * 评估评估能力 (0-10分)
   */
  private evaluateEvaluation(): number {
    let score = 0
    const evaluateRecords = this.getRecordsByPhase(AgentPhase.EVALUATE)

    // 是否进行了测试验证 (4分)
    const hasTesting = evaluateRecords.some(r =>
      r.action === AgentAction.BASH_EXECUTE &&
      (r.content.includes('test') ||
       r.content.includes('npm test') ||
       r.content.includes('运行'))
    )
    if (hasTesting) score += 4

    // 是否有反思记录 (3分)
    const hasReflection = evaluateRecords.some(r =>
      r.action === AgentAction.REFLECTION
    )
    if (hasReflection) score += 3

    // 是否根据结果调整 (3分)
    const hasIteration = this.getRecordsByPhase(AgentPhase.ITERATE).length > 0
    if (hasIteration) score += 3

    return Math.min(score, 10)
  }

  /**
   * 判断问题是否解决
   */
  private isProblemSolved(): boolean {
    // 检查最后几个记录是否表示成功
    const recentRecords = this.records.slice(-5)

    return recentRecords.some(r =>
      (r.action === AgentAction.WRITE_FILE ||
       r.action === AgentAction.EDIT_FILE) &&
      r.success &&
      (r.content.includes('完成') ||
       r.content.includes('成功') ||
       r.content.includes('done'))
    )
  }

  /**
   * 计算效度
   */
  private calculateEfficiency(totalTurns: number): number {
    // 基础分10分，每多一轮扣0.5分，最少保留2分
    const efficiency = Math.max(2, 10 - (totalTurns - 1) * 0.5)
    return parseFloat(efficiency.toFixed(2))
  }

  /**
   * 获取能力等级
   */
  private getCapabilityLevel(totalScore: number): 'S' | 'A' | 'B' | 'C' | 'D' {
    if (totalScore >= 45) return 'S'
    if (totalScore >= 35) return 'A'
    if (totalScore >= 25) return 'B'
    if (totalScore >= 15) return 'C'
    return 'D'
  }

  /**
   * 生成分析文本
   */
  private generateAnalysis(scores: {
    understanding: number
    retrieval: number
    analysis: number
    generation: number
    evaluation: number
    totalScore: number
    solved: boolean
    efficiency: number
  }): string[] {
    const analysis: string[] = []

    // 理解能力分析
    if (scores.understanding >= 8) {
      analysis.push('✓ 理解能力优秀：能准确识别和理解问题本质')
    } else if (scores.understanding >= 5) {
      analysis.push('○ 理解能力良好：基本能理解问题，但可能遗漏细节')
    } else {
      analysis.push('✗ 理解能力不足：未能准确理解问题需求')
    }

    // 检索能力分析
    if (scores.retrieval >= 8) {
      analysis.push('✓ 检索能力优秀：能主动且准确地查找相关信息')
    } else if (scores.retrieval >= 5) {
      analysis.push('○ 检索能力良好：能查找信息，但可能不够全面')
    } else {
      analysis.push('✗ 检索能力不足：信息查找不够主动或准确')
    }

    // 分析能力分析
    if (scores.analysis >= 8) {
      analysis.push('✓ 分析能力优秀：能深入分析问题原因和多种方案')
    } else if (scores.analysis >= 5) {
      analysis.push('○ 分析能力良好：能进行基本分析，但深度不够')
    } else {
      analysis.push('✗ 分析能力不足：分析能力欠缺，需要改进')
    }

    // 生成能力分析
    if (scores.generation >= 8) {
      analysis.push('✓ 生成能力优秀：能生成高质量、可运行的解决方案')
    } else if (scores.generation >= 5) {
      analysis.push('○ 生成能力良好：能生成方案，但可能需要调整')
    } else {
      analysis.push('✗ 生成能力不足：生成的解决方案质量较低')
    }

    // 评估能力分析
    if (scores.evaluation >= 8) {
      analysis.push('✓ 评估能力优秀：能有效验证和迭代改进')
    } else if (scores.evaluation >= 5) {
      analysis.push('○ 评估能力良好：有验证意识，但迭代不够')
    } else {
      analysis.push('✗ 评估能力不足：缺乏验证和迭代改进')
    }

    // 效率分析
    if (scores.efficiency >= 8) {
      analysis.push(`✓ 效率优秀：使用 ${this.records.filter(r => r.turn > 0).map(r => r.turn).sort((a,b) => a-b).pop() || 0} 轮次完成`)
    } else if (scores.efficiency >= 5) {
      analysis.push('○ 效率一般：轮次稍多，但可以接受')
    } else {
      analysis.push('✗ 效率较低：使用了过多轮次，需要优化')
    }

    return analysis
  }

  /**
   * 导出JSON报告
   */
  toJSON(): any {
    return this.generateReport()
  }

  /**
   * 导出文本报告
   */
  toText(): string {
    const report = this.generateReport()

    const lines: string[] = [
      '='.repeat(60),
      'Agent Loop 能力评估报告',
      '='.repeat(60),
      '',
      `问题ID: ${report.problemId}`,
      `问题描述: ${report.problem}`,
      '',
      '-' .repeat(60),
      '能力评分',
      '-' .repeat(60),
      '',
      `理解能力:  ${report.scores.understanding}/10`,
      `检索能力:  ${report.scores.retrieval}/10`,
      `分析能力:  ${report.scores.analysis}/10`,
      `生成能力:  ${report.scores.generation}/10`,
      `评估能力:  ${report.scores.evaluation}/10`,
      '',
      `总分:       ${report.totalScore}/50`,
      `等级:       ${report.capabilityLevel}`,
      `解决状态:   ${report.solved ? '✓ 已解决' : '✗ 未解决'}`,
      `效度:     ${report.efficiency}`,
      '',
      '-' .repeat(60),
      '能力分析',
      '-' .repeat(60),
      '',
      ...report.analysis,
      '',
      '-' .repeat(60),
      '执行记录',
      '-' .repeat(60),
      '',
    ]

    report.records.forEach(record => {
      lines.push(
        `[轮${record.turn}] ${record.phase}: ${record.action} - ${record.success ? '✓' : '✗'}`
      )
      if (record.error) {
        lines.push(`  错误: ${record.error}`)
      }
    })

    return lines.join('\n')
  }
}

/**
 * 生成评估报告JSON
 */
export function generateEvaluationReport(
  problemId: string,
  problem: string,
  events: StreamEvent[]
): ProblemSolvingReport {
  const tracker = new AgentLoopTracker(problemId, problem)

  // 从事件中提取执行记录
  let currentTurn = 0

  for (const event of events) {
    if (event.type === 'user_message') {
      currentTurn++
      tracker.setPhase(AgentPhase.UNDERSTAND)
      tracker.record(AgentAction.THINKING, '收到用户消息', true)
    } else if (event.type === 'assistant_message') {
      // 根据消息内容判断阶段
      const content = event.content || ''
      if (content.includes('查找') || content.includes('搜索')) {
        tracker.setPhase(AgentPhase.RETRIEVE)
      } else if (content.includes('分析') || content.includes('因为')) {
        tracker.setPhase(AgentPhase.ANALYZE)
      } else if (content.includes('生成') || content.includes('实现')) {
        tracker.setPhase(AgentPhase.GENERATE)
      } else if (content.includes('测试') || content.includes('验证')) {
        tracker.setPhase(AgentPhase.EVALUATE)
      }

      tracker.record(AgentAction.THINKING, content.substring(0, 100), true)
    } else if (event.type === 'tool_use') {
      const toolName = event.tool_name || 'unknown'

      if (toolName === 'FileReadTool') {
        tracker.record(AgentAction.READ_FILE, `读取文件: ${event.input?.file_path}`, true)
      } else if (toolName === 'FileWriteTool') {
        tracker.record(AgentAction.WRITE_FILE, `写入文件: ${event.input?.file_path}`, true)
      } else if (toolName === 'FileEditTool') {
        tracker.record(AgentAction.EDIT_FILE, `编辑文件: ${event.input?.file_path}`, true)
      } else if (toolName === 'GlobTool') {
        tracker.record(AgentAction.GLOB_SEARCH, `Glob搜索: ${event.input?.pattern}`, true)
      } else if (toolName === 'GrepTool') {
        tracker.record(AgentAction.GREP_SEARCH, `Grep搜索: ${event.input?.pattern}`, true)
      } else if (toolName === 'BashTool') {
        tracker.record(AgentAction.BASH_EXECUTE, `执行命令: ${event.input?.command}`, true)
      }
    } else if (event.type === 'tool_result') {
      // 根据结果判断成功或失败
      const isError = event.is_error || false
      if (isError) {
        tracker.record(AgentAction.REFLECTION, `执行失败，需要反思`, true, event.error)
      }
    }

    tracker.nextTurn()
  }

  return tracker.generateReport()
}
