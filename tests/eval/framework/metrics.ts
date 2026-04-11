/**
 * GRAPE 评分计算
 *
 * G - Goal        意图对齐：功能验证 + LLM Judge
 * R - Reasoning   推理规划：规划行为 + 步骤效率
 * A - Action      行动执行：工具选择效率 + 错误率
 * P - Proof       结果验证：主动验证行为
 * E - Expression  沟通表达：LLM Judge
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  TestCase, AgentTrace, GRAPEScore, GRAPEWeights,
  ValidatorResult, EvalConfig, Validator, TaskLevel,
} from './types.js'

export async function calculateGRAPE(
  testCase: TestCase,
  trace: AgentTrace,
  validatorResults: Array<{ validator: Validator; result: ValidatorResult }>,
  config: EvalConfig,
): Promise<GRAPEScore> {
  const weights = resolveWeights(testCase)

  const [goal, reasoning, action, proof, expression] = await Promise.all([
    scoreGoal(testCase, trace, validatorResults, config),
    scoreReasoning(testCase, trace),
    scoreAction(testCase, trace),
    scoreProof(testCase, trace),
    scoreExpression(testCase, trace, config),
  ])

  const composite =
    goal * weights.goal +
    reasoning * weights.reasoning +
    action * weights.action +
    proof * weights.proof +
    expression * weights.expression

  return {
    goal: Math.round(goal * 100),
    reasoning: Math.round(reasoning * 100),
    action: Math.round(action * 100),
    proof: Math.round(proof * 100),
    expression: Math.round(expression * 100),
    composite: Math.round(composite * 100),
  }
}

// ─── G: Goal ────────────────────────────────────────────────────────────────

async function scoreGoal(
  testCase: TestCase,
  trace: AgentTrace,
  validatorResults: Array<{ validator: Validator; result: ValidatorResult }>,
  config: EvalConfig,
): Promise<number> {
  // 1. Functional score (from validators)
  const nonLlmResults = validatorResults.filter(r => r.validator.type !== 'llm_judge')
  const functionalScore = nonLlmResults.length > 0
    ? nonLlmResults.reduce((sum, r) => sum + r.result.score, 0) / nonLlmResults.length
    : 0

  if (!config.llmJudgeEnabled) {
    return functionalScore
  }

  // 2. LLM Judge for semantic alignment
  const llmJudgeCriteria = validatorResults
    .filter(r => r.validator.type === 'llm_judge')
    .map(r => r.validator as Extract<Validator, { type: 'llm_judge' }>)

  if (llmJudgeCriteria.length === 0) {
    return functionalScore
  }

  const llmScore = await runLLMJudge(testCase, trace, llmJudgeCriteria, config)

  // Weighted: 60% functional, 40% semantic
  return functionalScore * 0.6 + llmScore * 0.4
}

// ─── R: Reasoning ────────────────────────────────────────────────────────────

function scoreReasoning(testCase: TestCase, trace: AgentTrace): number {
  let score = 1.0

  // 1. Planning usage (TodoWrite for M/L tasks)
  if (testCase.level !== 'S') {
    const hasTodoWrite = trace.toolCalls.some(t => t.name === 'TodoWrite')
    if (!hasTodoWrite && testCase.level === 'L') {
      score *= 0.7  // L 级任务不使用规划扣分较多
    } else if (!hasTodoWrite && testCase.level === 'M') {
      score *= 0.85
    }
  }

  // 2. Step efficiency (actual turns vs "reasonable" turns for this level)
  const expectedTurns = { S: 3, M: 12, L: 30 }[testCase.level]
  const efficiency = Math.min(1, expectedTurns / Math.max(1, trace.turnCount))
  const efficiencyScore = efficiency >= 0.3 ? 1 : efficiency / 0.3  // penalty only for very inefficient

  // 3. Clarification behavior for ambiguous tasks
  if (testCase.category === 'intent') {
    const hasAskUser = trace.toolCalls.some(t => t.name === 'AskUser')
    const hasQuestion = trace.messages.some(m => m.role === 'assistant' && m.content.includes('?'))
    if (!hasAskUser && !hasQuestion) {
      score *= 0.6  // Didn't clarify ambiguity
    }
  }

  // 4. Research planning (for research tasks)
  if (testCase.category === 'research') {
    const hasWebSearch = trace.toolCalls.some(t => t.name === 'WebSearch')
    const hasWebFetch = trace.toolCalls.some(t => t.name === 'WebFetch')
    const hasMultipleSources = trace.toolCalls.filter(t =>
      t.name === 'WebSearch' || t.name === 'WebFetch'
    ).length >= 2
    if (!hasWebSearch && !hasWebFetch) {
      score *= 0.4  // Research task with no web access
    } else if (!hasMultipleSources) {
      score *= 0.7  // Only one source
    }
  }

  return score * (0.7 + 0.3 * efficiencyScore)
}

// ─── A: Action ────────────────────────────────────────────────────────────────

function scoreAction(_testCase: TestCase, trace: AgentTrace): number {
  let score = 1.0

  // 1. Error rate
  const errorCalls = trace.toolCalls.filter(t => t.isError).length
  const errorRate = trace.toolCalls.length > 0
    ? errorCalls / trace.toolCalls.length
    : 0

  if (errorRate > 0.3) score *= 0.5
  else if (errorRate > 0.1) score *= 0.8
  else if (errorRate > 0) score *= 0.95

  // 2. Recovery attempts (too many = inefficient)
  if (trace.recoveryAttempts > 5) score *= 0.7
  else if (trace.recoveryAttempts > 2) score *= 0.9

  // 3. Redundant tool calls (same tool+input called twice)
  const callSignatures = trace.toolCalls.map(t =>
    `${t.name}:${JSON.stringify(t.input).slice(0, 50)}`
  )
  const uniqueSignatures = new Set(callSignatures)
  const redundancyRate = 1 - uniqueSignatures.size / Math.max(1, callSignatures.length)
  if (redundancyRate > 0.2) score *= 0.8

  // 4. Used Bash when dedicated tool existed
  const bashCallsWhenToolExists = trace.toolCalls.filter(t => {
    if (t.name !== 'Bash') return false
    const cmd = (t.input['command'] as string) || ''
    return /^(cat|ls|grep|find)\s/.test(cmd)
  }).length
  if (bashCallsWhenToolExists > 2) score *= 0.85

  return score
}

// ─── P: Proof ────────────────────────────────────────────────────────────────

function scoreProof(testCase: TestCase, trace: AgentTrace): number {
  const verificationCmds = ['npm test', 'vitest', 'jest', 'pytest', 'npx tsc', 'tsc --noEmit', 'cargo test', 'go test']

  const ranTests = trace.toolCalls.some(t =>
    t.name === 'Bash' &&
    verificationCmds.some(cmd => ((t.input['command'] as string) || '').includes(cmd))
  )

  const ranCompiler = trace.toolCalls.some(t =>
    t.name === 'Bash' &&
    ['tsc', 'tsc --noEmit', 'npx tsc'].some(cmd => ((t.input['command'] as string) || '').startsWith(cmd))
  )

  // For S tasks, verification is less critical
  if (testCase.level === 'S') {
    return ranTests || ranCompiler ? 1.0 : 0.6
  }

  // For M/L tasks, verification is expected
  if (testCase.level === 'M') {
    if (ranTests && ranCompiler) return 1.0
    if (ranTests || ranCompiler) return 0.75
    return 0.3
  }

  // L: requires comprehensive verification
  if (ranTests && ranCompiler) return 1.0
  if (ranTests || ranCompiler) return 0.6
  return 0.2
}

// ─── E: Expression ────────────────────────────────────────────────────────────

async function scoreExpression(
  testCase: TestCase,
  trace: AgentTrace,
  config: EvalConfig,
): Promise<number> {
  if (!config.llmJudgeEnabled || !trace.finalResponse) {
    // Heuristic fallback
    const hasResponse = trace.finalResponse.length > 20
    const tooLong = trace.finalResponse.length > 5000
    if (!hasResponse) return 0.3
    if (tooLong) return 0.6
    return 0.8
  }

  // LLM Judge for expression quality
  try {
    const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl })
    const prompt = `Evaluate the quality of this AI assistant's final response to the user.

Original task: ${testCase.prompt}

AI's final response:
${trace.finalResponse.slice(0, 2000)}

Rate the response on these criteria (answer with a JSON object):
1. accuracy: Did it accurately describe what was done? (0-10)
2. completeness: Did it cover all aspects of the task? (0-10)  
3. clarity: Is it clear and easy to understand? (0-10)
4. no_hallucination: Did it avoid false claims? (0-10)
5. appropriate_detail: Is the level of detail appropriate? (0-10)

Respond with ONLY a JSON object like: {"accuracy":8,"completeness":7,"clarity":9,"no_hallucination":10,"appropriate_detail":7}`

    const response = await client.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const scores = JSON.parse(text) as Record<string, number>
    const avg = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length
    return avg / 10
  } catch {
    return 0.7  // Default on error
  }
}

// ─── LLM Judge ────────────────────────────────────────────────────────────────

async function runLLMJudge(
  testCase: TestCase,
  trace: AgentTrace,
  criteria: Array<Extract<Validator, { type: 'llm_judge' }>>,
  config: EvalConfig,
): Promise<number> {
  try {
    const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl })

    const criteriaText = criteria.map((c, i) => `${i + 1}. ${c.criterion}`).join('\n')

    const toolSummary = trace.toolCalls
      .map(t => `${t.name}(${JSON.stringify(t.input).slice(0, 80)})`)
      .join(', ')

    const prompt = `You are evaluating an AI coding assistant's work.

Task given to the assistant: "${testCase.prompt}"

Tools called (in order): ${toolSummary.slice(0, 1000)}

Final response: ${trace.finalResponse.slice(0, 2000)}

Evaluate each criterion (score 0-100):
${criteriaText}

Respond with ONLY a JSON array of scores: [score1, score2, ...]`

    const response = await client.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '[]'
    const scores = JSON.parse(text) as number[]
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    return avg / 100
  } catch {
    return 0.5
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const _DEFAULT_WEIGHTS: Record<TaskLevel, GRAPEWeights> = {
  S: { goal: 0.40, reasoning: 0.10, action: 0.25, proof: 0.15, expression: 0.10 },
  M: { goal: 0.25, reasoning: 0.25, action: 0.20, proof: 0.20, expression: 0.10 },
  L: { goal: 0.20, reasoning: 0.25, action: 0.15, proof: 0.20, expression: 0.20 },
}

const _RESEARCH_WEIGHTS: GRAPEWeights =
  { goal: 0.25, reasoning: 0.20, action: 0.15, proof: 0.15, expression: 0.25 }

function resolveWeights(testCase: TestCase): GRAPEWeights {
  const base = testCase.category === 'research'
    ? _RESEARCH_WEIGHTS
    : _DEFAULT_WEIGHTS[testCase.level]

  if (!testCase.weights) return base
  return { ...base, ...testCase.weights }
}
