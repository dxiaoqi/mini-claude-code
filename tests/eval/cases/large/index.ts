/**
 * L 级测试用例（20+ 轮，跨包修改，可用 Coordinator）
 */
import type { TestCase } from '../../framework/types.js'

export const largeCases: TestCase[] = [

  // ─── 端到端功能实现 ───────────────────────────────────────────────────────

  {
    id: 'L-feature-e2e-01',
    level: 'L', category: 'execution',
    title: 'E2E：接入 auth 到 API（保护路由）',
    description: 'auth 包已就位但 API 路由完全未受保护',
    prompt: '查看整个项目，把认证系统接入 API：1) GET /api/users 和 POST /api/users 不需要认证，2) PUT /api/users/:id 和 DELETE /api/users/:id 需要认证，3) DELETE 需要 admin 角色，4) 在 apps/server 添加 /auth/login 和 /auth/register 路由，5) 写集成测试',
    fixture: 'monorepo',
    validators: [
      { type: 'used_planning' },
      { type: 'file_contains', path: 'packages/auth/src/middleware.ts', pattern: /requireAuth|verifyToken/ },
      // Protected routes use auth middleware
      { type: 'file_contains', path: 'packages/api/src/routes/users.ts', pattern: /requireAuth|requireRole/ },
      // Login route added
      {
        type: 'custom',
        fn: async (env, trace) => {
          const { readdir } = await import('node:fs/promises')
          const { existsSync } = await import('node:fs')
          const serverSrc = `${env.cwd}/apps/server/src`
          if (!existsSync(serverSrc)) {
            return { passed: false, score: 0, message: 'apps/server/src not found' }
          }
          const files = await readdir(serverSrc, { recursive: true })
          const hasAuthRoute = files.some((f: unknown) => String(f).includes('auth'))
          return {
            passed: hasAuthRoute,
            score: hasAuthRoute ? 1 : 0,
            message: hasAuthRoute ? 'Auth route found in server' : 'No auth route in apps/server',
          }
        },
      },
      { type: 'command_success', command: 'npx tsc --noEmit' },
      { type: 'command_success', command: 'npm test' },
      { type: 'verified_result' },
    ],
    maxTurns: 40,
  },

  // ─── 多 Agent 协调 ────────────────────────────────────────────────────────

  {
    id: 'L-multiagent-parallel-01',
    level: 'L', category: 'multiagent',
    title: 'Coordinator：并行修复多个 bug',
    description: '三个包各有一个 bug，可以并行修复',
    prompt: '这个 monorepo 有多个 bug：1) packages/core 的分页逻辑，2) packages/api 的响应格式，3) packages/auth 的错误处理。请并行派出 Worker 分别修复这三个问题，然后综合验证',
    fixture: 'monorepo',
    useCoordinator: true,
    validators: [
      { type: 'agent_spawned', minAgents: 2 },
      { type: 'command_success', command: 'npm test' },
      { type: 'command_success', command: 'npx tsc --noEmit' },
      {
        type: 'custom',
        fn: async (env, trace) => {
          const parallelAtTurn1 = trace.toolCalls.filter(t =>
            t.name === 'Agent' && t.turnIndex <= 1
          ).length
          const isParallel = parallelAtTurn1 >= 2
          return {
            passed: isParallel,
            score: isParallel ? 1 : 0.4,
            message: isParallel
              ? `${parallelAtTurn1} agents spawned in parallel`
              : `Agents not spawned in parallel (only ${parallelAtTurn1} at turn 0-1)`,
          }
        },
      },
    ],
    maxTurns: 60,
  },

  {
    id: 'L-multiagent-research-impl-01',
    level: 'L', category: 'multiagent',
    title: 'Coordinator：Research + 并行实施',
    description: '先研究，Coordinator 综合，再并行实施',
    prompt: '我们需要给这个 API 添加缓存层。请：1) 派 Worker 研究 Redis vs in-memory caching（node-cache/lru-cache）的优缺点，2) 你来综合分析并制定实施方案，3) 派 Worker 在 packages/api 实现缓存中间件，4) 派 Worker 写测试',
    fixture: 'monorepo-clean',
    useCoordinator: true,
    validators: [
      { type: 'agent_spawned', minAgents: 3 },
      { type: 'used_planning' },
      {
        type: 'custom',
        fn: async (env, trace) => {
          // Research workers should come before implementation workers
          const agentCalls = trace.toolCalls.filter(t => t.name === 'Agent')
          const researchAgent = agentCalls.find(t =>
            JSON.stringify(t.input).toLowerCase().includes('research') ||
            JSON.stringify(t.input).toLowerCase().includes('compare')
          )
          const implAgent = agentCalls.find(t =>
            JSON.stringify(t.input).toLowerCase().includes('implement') ||
            JSON.stringify(t.input).toLowerCase().includes('cache middleware')
          )
          const researchFirst = researchAgent && implAgent &&
            (researchAgent.turnIndex ?? 0) <= (implAgent.turnIndex ?? 0)
          return {
            passed: !!researchFirst,
            score: researchFirst ? 1 : 0.4,
            message: researchFirst
              ? 'Research happened before implementation'
              : 'Did not research before implementing',
          }
        },
      },
      { type: 'llm_judge', criterion: 'Coordinator synthesized research findings before directing implementation', minScore: 70 },
      { type: 'command_success', command: 'npx tsc --noEmit' },
    ],
    researchTargets: ['Redis', 'in-memory cache', 'TTL', 'cache invalidation'],
    maxTurns: 60,
  },

  // ─── 性能优化 ─────────────────────────────────────────────────────────────

  {
    id: 'L-perf-n-plus-one-01',
    level: 'L', category: 'execution',
    title: '性能优化：修复 N+1 查询',
    description: 'posts 路由有 N+1 查询问题',
    prompt: '运行 packages/api 的代码，检查 GET /api/posts 的实现，发现并修复性能问题，添加性能测试',
    fixture: 'monorepo-perf',
    validators: [
      { type: 'used_planning' },
      { type: 'file_contains', path: 'packages/api/src/routes/posts.ts', pattern: /Map|reduce|lookup|index/ },
      { type: 'file_not_contains', path: 'packages/api/src/routes/posts.ts', pattern: /map.*find|find.*inside.*map/ },
      { type: 'llm_judge', criterion: 'Fixed the N+1 problem by precomputing a user lookup map or similar O(n) approach', minScore: 75 },
    ],
    maxTurns: 25,
  },

  // ─── 大型 Research ────────────────────────────────────────────────────────

  {
    id: 'L-research-migration-01',
    level: 'L', category: 'research',
    title: 'Research + 迁移：数据库方案选型与实施',
    prompt: '这个项目目前用 in-memory 存储，需要迁移到真实数据库。帮我：1) 研究适合这个 Node.js/TypeScript monorepo 的 ORM 方案（Prisma vs Drizzle vs TypeORM），2) 综合分析后选择一个，3) 在 packages/core 创建数据库抽象层，4) 更新 packages/api 使用新的数据层，5) 写迁移文档',
    fixture: 'monorepo-clean',
    validators: [
      { type: 'used_planning' },
      {
        type: 'custom',
        fn: async (env, trace) => {
          const webSearchCalls = trace.toolCalls.filter(t =>
            t.name === 'WebSearch' || t.name === 'WebFetch'
          ).length
          return {
            passed: webSearchCalls >= 2,
            score: Math.min(1, webSearchCalls / 3),
            message: `${webSearchCalls} research calls (need ≥2 for multi-source comparison)`,
          }
        },
      },
      {
        type: 'custom',
        fn: async (env, trace) => {
          const { existsSync } = await import('node:fs')
          const hasMigrationDoc = existsSync(`${env.cwd}/MIGRATION.md`) ||
            existsSync(`${env.cwd}/docs/migration.md`) ||
            existsSync(`${env.cwd}/packages/core/MIGRATION.md`)
          return {
            passed: hasMigrationDoc,
            score: hasMigrationDoc ? 1 : 0,
            message: hasMigrationDoc ? 'Migration doc created' : 'No migration documentation',
          }
        },
      },
      { type: 'file_exists', path: 'packages/core/src/db.ts' },
      { type: 'command_success', command: 'npx tsc --noEmit' },
      { type: 'llm_judge', criterion: 'Research covers trade-offs between ORM options with concrete technical reasoning', minScore: 75 },
      { type: 'llm_judge', criterion: 'Final choice is justified based on project characteristics (TypeScript, monorepo, etc)', minScore: 70 },
    ],
    researchTargets: ['Prisma', 'Drizzle', 'TypeORM', 'type safety', 'migrations'],
    maxTurns: 50,
  },
]
