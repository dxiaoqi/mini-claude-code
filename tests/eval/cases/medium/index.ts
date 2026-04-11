/**
 * M 级测试用例（5-20 轮，多文件修改）
 * 覆盖：Bug 修复、新增功能、重构、Research + 实施
 */
import type { TestCase } from '../../framework/types.js'

export const mediumCases: TestCase[] = [

  // ─── Bug 修复 + 验证 ──────────────────────────────────────────────────────

  {
    id: 'M-bugfix-logic-01',
    level: 'M', category: 'execution',
    title: 'Bug修复：分页逻辑错误',
    description: 'paginate 函数有 off-by-one 错误，测试跑不过',
    prompt: '运行 npm test，找到失败的测试并修复 bug',
    fixture: 'monorepo',
    validators: [
      // 先跑测试
      {
        type: 'custom',
        fn: async (env, trace) => {
          const firstBash = trace.toolCalls.findIndex(t => t.name === 'Bash')
          const firstEdit = trace.toolCalls.findIndex(t => t.name === 'FileEdit')
          const testFirst = firstBash !== -1 && (firstEdit === -1 || firstBash < firstEdit)
          return {
            passed: testFirst,
            score: testFirst ? 1 : 0,
            message: testFirst ? 'Agent ran tests before editing' : 'Agent edited before running tests',
          }
        },
      },
      { type: 'file_contains', path: 'packages/core/src/utils.ts', pattern: /slice\(start, end\)|slice\(start,\s*end\)/ },
      { type: 'command_success', command: 'npm test' },
      { type: 'verified_result' },
    ],
    maxTurns: 15,
  },

  {
    id: 'M-bugfix-type-01',
    level: 'M', category: 'execution',
    title: 'Bug修复：API 返回格式错误',
    description: 'GET /api/users 返回裸数组而非 { data, total, page, pageSize }',
    prompt: '前端同学反映 GET /api/users 的响应格式不对，应该返回 { data: [], total: number, page: number, pageSize: number }，但实际返回的是一个数组，帮我修复',
    fixture: 'monorepo',
    validators: [
      { type: 'file_contains', path: 'packages/api/src/routes/users.ts', pattern: /data.*total.*page|res\.json\(\{.*data/ },
      { type: 'command_success', command: 'npm test' },
      { type: 'command_success', command: 'npx tsc --noEmit' },
    ],
    maxTurns: 12,
  },

  {
    id: 'M-bugfix-async-01',
    level: 'M', category: 'execution',
    title: 'Bug修复：JWT 过期错误处理',
    description: 'auth 包的 verifyToken 不区分 TokenExpiredError 和 JsonWebTokenError',
    prompt: '用户反映登录过期后看到的错误信息不够友好，只看到 "Invalid token" 而不是 "Token expired"。帮我找到相关代码并修复',
    fixture: 'monorepo',
    validators: [
      { type: 'tool_called', toolName: 'Grep', description: 'Should search for token-related code' },
      { type: 'file_contains', path: 'packages/auth/src/jwt.ts', pattern: /TokenExpiredError/ },
      { type: 'file_contains', path: 'packages/auth/src/jwt.ts', pattern: /Token expired/ },
      { type: 'command_success', command: 'npm test' },
    ],
    maxTurns: 15,
  },

  // ─── 新增功能 ─────────────────────────────────────────────────────────────

  {
    id: 'M-feature-crud-01',
    level: 'M', category: 'execution',
    title: '新增功能：完善 Users CRUD',
    description: '用户路由缺少 PUT 和 DELETE，需要补全',
    prompt: '查看 packages/api/src/routes/users.ts，里面 TODO 注释标记了缺少的端点，请实现 PUT /users/:id 和 DELETE /users/:id，并更新测试',
    fixture: 'monorepo',
    validators: [
      { type: 'file_contains', path: 'packages/api/src/routes/users.ts', pattern: /\.put\(.*\/:id|usersRouter\.put/ },
      { type: 'file_contains', path: 'packages/api/src/routes/users.ts', pattern: /\.delete\(.*\/:id|usersRouter\.delete/ },
      { type: 'tool_not_called', toolName: 'AskUser', description: 'Task is clear, should not ask' },
      { type: 'command_success', command: 'npm test' },
      { type: 'command_success', command: 'npx tsc --noEmit' },
    ],
    maxTurns: 18,
  },

  {
    id: 'M-feature-auth-middleware-01',
    level: 'M', category: 'execution',
    title: '新增功能：实现 auth middleware',
    description: 'auth 包的 requireAuth 和 requireRole 是空实现',
    prompt: '查看 packages/auth/src/middleware.ts，有两个未实现的函数，请实现它们。requireAuth 应该从 Authorization header 提取 Bearer token 并验证，requireRole 应该检查用户角色',
    fixture: 'monorepo',
    validators: [
      { type: 'file_not_contains', path: 'packages/auth/src/middleware.ts', pattern: /throw new Error\('Not implemented'\)/ },
      { type: 'file_contains', path: 'packages/auth/src/middleware.ts', pattern: /verifyToken|extractTokenFromHeader/ },
      { type: 'file_contains', path: 'packages/auth/src/middleware.ts', pattern: /req\.user/ },
      { type: 'command_success', command: 'npx tsc --noEmit' },
      { type: 'verified_result' },
    ],
    maxTurns: 15,
  },

  // ─── 重构 ─────────────────────────────────────────────────────────────────

  {
    id: 'M-refactor-error-handling-01',
    level: 'M', category: 'execution',
    title: '重构：统一客户端错误处理',
    description: 'packages/client 的 request 方法不处理 HTTP 错误',
    prompt: '审查 packages/client/src/client.ts 里的 request 方法，它目前没有正确处理 HTTP 错误（4xx/5xx）。请重构它，让错误响应能正确抛出 AppError（来自 @acme/core），并写测试验证',
    fixture: 'monorepo',
    validators: [
      { type: 'file_contains', path: 'packages/client/src/client.ts', pattern: /res\.ok|AppError/ },
      { type: 'file_contains', path: 'packages/client/src/client.ts', pattern: /throw/ },
      { type: 'command_success', command: 'npx tsc --noEmit' },
      { type: 'llm_judge', criterion: 'Error handling properly checks res.ok and throws AppError with status code', minScore: 75 },
    ],
    maxTurns: 15,
  },

  // ─── 规划能力 ─────────────────────────────────────────────────────────────

  {
    id: 'M-planning-multi-file-01',
    level: 'M', category: 'planning',
    title: '规划：多文件联动修改',
    prompt: '把 packages/core/src/utils.ts 里的 paginate 函数改成支持 cursor-based pagination（用 cursor 而不是 page number），同时更新所有使用了这个函数的地方和对应的测试',
    fixture: 'monorepo-clean',
    validators: [
      { type: 'used_planning', description: 'Multi-file change requires planning' },
      { type: 'tool_called', toolName: 'Grep', description: 'Should find all usages first' },
      { type: 'file_contains', path: 'packages/core/src/utils.ts', pattern: /cursor/ },
      { type: 'command_success', command: 'npx tsc --noEmit' },
      { type: 'command_success', command: 'npm test' },
    ],
    maxTurns: 20,
  },

  // ─── Research + 实施 ──────────────────────────────────────────────────────

  {
    id: 'M-research-impl-01',
    level: 'M', category: 'research',
    title: 'Research + 实施：选型并接入日志库',
    prompt: '我们需要给这个项目加结构化日志。帮我：1) 研究 pino vs winston 的对比，选一个更适合高性能 API 的方案，2) 在 packages/api 中集成所选方案，至少记录每个请求的 method、path、statusCode、durationMs',
    fixture: 'monorepo-clean',
    validators: [
      { type: 'file_contains', path: 'packages/api/package.json', pattern: /pino|winston/ },
      {
        type: 'custom',
        fn: async (env, trace) => {
          // 应该先研究（WebSearch/WebFetch）再实现
          const researchIdx = trace.toolCalls.findIndex(t =>
            t.name === 'WebSearch' || t.name === 'WebFetch' || t.name === 'ToolSearch'
          )
          const implIdx = trace.toolCalls.findIndex(t =>
            t.name === 'FileEdit' || t.name === 'FileWrite'
          )
          const researchFirst = researchIdx !== -1 && (implIdx === -1 || researchIdx < implIdx)
          return {
            passed: researchFirst,
            score: researchFirst ? 1 : 0.3,
            message: researchFirst
              ? 'Agent researched before implementing'
              : `Agent implemented (turn ${implIdx}) before researching (turn ${researchIdx})`,
          }
        },
      },
      { type: 'file_contains', path: 'packages/api/src/middleware.ts', pattern: /logger|log|pino|winston/ },
      { type: 'command_success', command: 'npx tsc --noEmit' },
      { type: 'llm_judge', criterion: 'Response explains the technical choice between pino and winston with reasoning', minScore: 70 },
    ],
    researchTargets: ['pino performance', 'winston features', 'structured logging'],
    expectedDecision: 'pino (performance) or winston (features)',
    maxTurns: 25,
  },

  {
    id: 'M-research-security-01',
    level: 'M', category: 'research',
    title: 'Research + 审计：安全审查 JWT 实现',
    prompt: '审查 packages/auth 目录的安全性，研究 JWT 最佳实践，找出潜在的安全问题并修复',
    fixture: 'monorepo',
    validators: [
      { type: 'llm_judge', criterion: 'Agent identified at least one security issue (hardcoded secret, expiry handling, etc)', minScore: 75 },
      { type: 'llm_judge', criterion: 'Agent provided concrete fixes not just theoretical recommendations', minScore: 70 },
      { type: 'file_contains', path: 'packages/auth/src/jwt.ts', pattern: /process\.env|SECRET/ },
    ],
    researchTargets: ['JWT security', 'token expiry', 'secret management'],
    maxTurns: 20,
  },
]
