/**
 * utils/cost.ts — 模型定价与成本估算
 *
 * 维护常见模型的百万 token 单价（USD），并据输入/输出与 cache 读用量估算费用。
 */

/**
 * Model pricing per million tokens (USD).
 * Covers common models from Anthropic and OpenAI-compatible providers.
 */
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead?: number }> = {
  'claude-sonnet-4-20250514': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-opus-4-20250514': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4, cacheRead: 0.08 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
): number {
  const pricing = findPricing(model)
  if (!pricing) return 0

  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  const cacheCost = pricing.cacheRead ? (cacheReadTokens / 1_000_000) * pricing.cacheRead : 0

  return inputCost + outputCost + cacheCost
}

function findPricing(model: string): { input: number; output: number; cacheRead?: number } | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model]

  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (model.includes(key) || key.includes(model)) return val
  }

  return null
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`
  return `$${usd.toFixed(4)}`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
