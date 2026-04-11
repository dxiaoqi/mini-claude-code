/**
 * S 级测试用例（1-3 轮，1-4 工具调用）
 * 覆盖：明确意图、模糊意图、研究场景
 */
import type { TestCase } from '../../framework/types.js'

export const smallCases: TestCase[] = [

  // ─── 意图理解 ──────────────────────────────────────────────────────────────

  {
    id: 'S-intent-clear-01',
    level: 'S', category: 'intent',
    title: '明确意图：读取 package.json',
    prompt: '读取 packages/core/package.json 文件，告诉我包名和版本号',
    fixture: 'monorepo',
    validators: [
      { type: 'tool_called', toolName: 'FileRead' },
      { type: 'llm_judge', criterion: 'Response mentions @acme/core and version 1.0.0', minScore: 80 },
    ],
    maxTurns: 3,
  },

  {
    id: 'S-intent-ambiguous-01',
    level: 'S', category: 'intent',
    title: '模糊意图：没说哪个文件',
    prompt: '这个函数好像有问题',
    fixture: 'monorepo',
    validators: [
      // 关键：面对模糊意图，Agent 应该询问而不是乱猜修改
      { type: 'asked_clarification', description: 'Agent should ask which function' },
      { type: 'tool_not_called', toolName: 'FileEdit', description: 'Should not edit without knowing which file' },
    ],
    maxTurns: 3,
  },

  {
    id: 'S-intent-ambiguous-02',
    level: 'S', category: 'intent',
    title: '模糊意图：测试跑不过（无错误信息）',
    prompt: '测试跑不过',
    fixture: 'monorepo',
    validators: [
      // Agent 应该先跑测试获取错误信息，而非直接修改
      { type: 'tool_called', toolName: 'Bash', description: 'Should run tests first to see what fails' },
      {
        type: 'custom',
        fn: async (env, trace) => {
          const firstAction = trace.toolCalls[0]
          const isRunningTests = firstAction?.name === 'Bash' &&
            ['npm test', 'vitest', 'npx vitest'].some(cmd =>
              (firstAction.input['command'] as string || '').includes(cmd)
            )
          return {
            passed: isRunningTests,
            score: isRunningTests ? 1 : 0,
            message: isRunningTests
              ? 'Agent correctly ran tests first to understand the failure'
              : `Agent's first action was ${firstAction?.name}(${JSON.stringify(firstAction?.input).slice(0,80)}) instead of running tests`,
          }
        },
      },
    ],
    maxTurns: 5,
  },

  {
    id: 'S-intent-overscope-01',
    level: 'S', category: 'intent',
    title: '范围控制：只修改一处不要扩展',
    prompt: '把 packages/core/src/utils.ts 里 truncate 函数的最大长度改成 100',
    fixture: 'monorepo',
    validators: [
      { type: 'file_contains', path: 'packages/core/src/utils.ts', pattern: /maxLength.*100|100.*maxLength/ },
      // 不应该修改其他文件（范围控制）
      {
        type: 'custom',
        fn: async (env, trace) => {
          const editedFiles = trace.toolCalls
            .filter(t => t.name === 'FileEdit' || t.name === 'FileWrite')
            .map(t => t.input['file_path'] as string || t.input['path'] as string || '')
            .filter(Boolean)
          const wrongFiles = editedFiles.filter(f => !f.includes('utils.ts'))
          return {
            passed: wrongFiles.length === 0,
            score: wrongFiles.length === 0 ? 1 : 0,
            message: wrongFiles.length === 0
              ? 'Agent only modified the target file'
              : `Agent modified unexpected files: ${wrongFiles.join(', ')}`,
          }
        },
      },
    ],
    maxTurns: 4,
  },

  // ─── 执行效率 ─────────────────────────────────────────────────────────────

  {
    id: 'S-execution-read-01',
    level: 'S', category: 'execution',
    title: '高效工具选择：搜索文件内容',
    prompt: '在 packages/core/src/ 下找到所有导出 AppError 的文件',
    fixture: 'monorepo',
    validators: [
      // 应该用 Grep 而不是多次 FileRead
      { type: 'tool_called', toolName: 'Grep' },
      { type: 'llm_judge', criterion: 'Response mentions errors.ts as the file exporting AppError', minScore: 75 },
    ],
    weights: { action: 0.40, goal: 0.40, reasoning: 0.10, proof: 0.05, expression: 0.05 },
    maxTurns: 3,
  },

  {
    id: 'S-execution-create-01',
    level: 'S', category: 'execution',
    title: '创建文件：新增工具函数',
    prompt: '在 packages/core/src/utils.ts 里新增一个 capitalize 函数，把字符串首字母大写',
    fixture: 'monorepo',
    validators: [
      { type: 'file_contains', path: 'packages/core/src/utils.ts', pattern: /capitalize/ },
      { type: 'file_contains', path: 'packages/core/src/utils.ts', pattern: /toUpperCase|charAt|slice/ },
      { type: 'command_success', command: 'npx tsc --noEmit' },
    ],
    maxTurns: 5,
  },

  // ─── Research 场景 ────────────────────────────────────────────────────────

  {
    id: 'S-research-lib-compare-01',
    level: 'S', category: 'research',
    title: 'Research：选择 Node.js 日志库',
    prompt: '我需要给这个项目加日志功能，帮我研究一下现在主流的 Node.js 日志库（pino、winston、bunyan 等），推荐一个并说明理由',
    fixture: 'monorepo',
    validators: [
      { type: 'tool_called', toolName: 'ToolSearch' },  // 应该先搜索 WebSearch 工具
      { type: 'llm_judge', criterion: 'Response compares multiple logging libraries and provides reasoned recommendation', minScore: 70 },
      { type: 'llm_judge', criterion: 'Response mentions performance, features, or ecosystem considerations', minScore: 65 },
    ],
    researchTargets: ['pino', 'winston', 'performance', 'structured logging'],
    maxTurns: 8,
  },

  {
    id: 'S-research-docs-01',
    level: 'S', category: 'research',
    title: 'Research：查阅 Express 文档',
    prompt: '我想给 Express API 加 rate limiting，帮我查一下最新的推荐方案是什么，有没有官方中间件？',
    fixture: 'monorepo',
    validators: [
      { type: 'llm_judge', criterion: 'Response mentions express-rate-limit or similar packages with installation instructions', minScore: 70 },
      { type: 'llm_judge', criterion: 'Response provides actionable implementation guidance', minScore: 65 },
    ],
    researchTargets: ['express-rate-limit', 'rate limiting', 'middleware'],
    maxTurns: 8,
  },
]
