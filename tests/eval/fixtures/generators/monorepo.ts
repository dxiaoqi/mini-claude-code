/**
 * Monorepo Fixture Generator
 *
 * 生成一个 Turborepo 风格的 Node.js monorepo，包含：
 *   packages/
 *     core/        — 共享工具库（含预埋 bug）
 *     api/         — Express REST API（含类型错误 + 逻辑 bug）
 *     auth/        — JWT 认证模块（未完整实现）
 *     client/      — API 客户端库（含错误处理缺失）
 *   apps/
 *     server/      — 主服务入口（整合 api + auth）
 *
 * 复杂度特征：
 *   - 跨包依赖（workspace: 协议）
 *   - 共享 TypeScript 配置
 *   - 统一测试框架（vitest）
 *   - 预埋 5 类典型 bug
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface MonorepoOptions {
  /** 是否注入 bug（默认 true） */
  withBugs?: boolean
  /** 是否包含未实现的功能（默认 true） */
  withMissingFeatures?: boolean
  /** 是否注入性能问题（默认 false） */
  withPerformanceIssues?: boolean
  /** 预埋的 bug 类型 */
  bugTypes?: Array<'type_error' | 'logic_error' | 'async_error' | 'security' | 'memory_leak'>
}

export async function generateMonorepo(targetDir: string, opts: MonorepoOptions = {}): Promise<void> {
  const {
    withBugs = true,
    withMissingFeatures = true,
    withPerformanceIssues = false,
    bugTypes = ['type_error', 'logic_error', 'async_error'],
  } = opts

  await writeRootConfig(targetDir)
  await writePackageCore(targetDir, withBugs && bugTypes.includes('logic_error'))
  await writePackageApi(targetDir, withBugs && bugTypes.includes('type_error'), withMissingFeatures)
  await writePackageAuth(targetDir, withBugs && bugTypes.includes('async_error'), withMissingFeatures)
  await writePackageClient(targetDir, withBugs && bugTypes.includes('type_error'))
  await writeAppServer(targetDir)
  if (withPerformanceIssues) {
    await injectPerformanceBug(targetDir)
  }
}

// ─── Root Config ─────────────────────────────────────────────────────────────

async function writeRootConfig(dir: string): Promise<void> {
  await ensureDir(dir)

  await write(dir, 'package.json', JSON.stringify({
    name: 'acme-platform',
    version: '1.0.0',
    private: true,
    workspaces: ['packages/*', 'apps/*'],
    scripts: {
      build: 'tsc -b',
      test: 'vitest run',
      'test:coverage': 'vitest run --coverage',
      lint: 'eslint . --ext .ts',
      typecheck: 'tsc --noEmit',
    },
    devDependencies: {
      typescript: '^5.3.0',
      vitest: '^1.2.0',
      '@types/node': '^20.0.0',
      '@types/express': '^4.17.21',
      '@types/jsonwebtoken': '^9.0.5',
    },
  }, null, 2))

  await write(dir, 'tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'Node16',
      moduleResolution: 'Node16',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      composite: true,
    },
    references: [
      { path: './packages/core' },
      { path: './packages/api' },
      { path: './packages/auth' },
      { path: './packages/client' },
      { path: './apps/server' },
    ],
  }, null, 2))

  await write(dir, 'vitest.config.ts',
    `import { defineConfig } from 'vitest/config'\n\nexport default defineConfig({\n  test: {\n    globals: true,\n    environment: 'node',\n  },\n})\n`
  )

  await write(dir, '.env.example',
    `JWT_SECRET=your-secret-here\nPORT=3000\nDB_URL=postgresql://localhost/acme\n`
  )

  await write(dir, 'README.md',
    `# Acme Platform\n\nA monorepo for the Acme Platform services.\n\n## Structure\n\n- \`packages/core\` — shared utilities\n- \`packages/api\` — REST API\n- \`packages/auth\` — authentication\n- \`packages/client\` — API client\n- \`apps/server\` — main server\n`
  )
}

// ─── packages/core ───────────────────────────────────────────────────────────

async function writePackageCore(dir: string, withLogicBug: boolean): Promise<void> {
  const pkg = resolve(dir, 'packages/core')
  await ensureDir(`${pkg}/src`)

  await write(pkg, 'package.json', JSON.stringify({
    name: '@acme/core',
    version: '1.0.0',
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
  }, null, 2))

  await write(pkg, 'tsconfig.json', JSON.stringify({
    extends: '../../tsconfig.json',
    compilerOptions: { outDir: './dist', rootDir: './src', declaration: true },
    include: ['src/**/*'],
  }, null, 2))

  // utils.ts — 含 logic_error：分页计算错误
  const paginateLogic = withLogicBug
    ? `  const start = (page - 1) * pageSize  // BUG: should be (page - 1) * pageSize but returns wrong slice\n  const end = start + pageSize\n  return items.slice(start, end + 1) // BUG: off-by-one`
    : `  const start = (page - 1) * pageSize\n  const end = start + pageSize\n  return items.slice(start, end)`

  await write(`${pkg}/src`, 'utils.ts', `/**
 * Core utilities shared across the platform
 */

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
${paginateLogic}
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString().split('T')[0]
}

export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key]
    if (srcVal !== undefined && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
      result[key] = deepMerge(result[key] as object, srcVal as object) as T[keyof T]
    } else if (srcVal !== undefined) {
      result[key] = srcVal as T[keyof T]
    }
  }
  return result
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}
`)

  await write(`${pkg}/src`, 'errors.ts', `export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string | number) {
    super(\`\${resource} with id \${id} not found\`, 'NOT_FOUND', 404)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 422)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401)
  }
}
`)

  await write(`${pkg}/src`, 'index.ts', `export * from './utils.js'\nexport * from './errors.js'\n`)

  await write(`${pkg}/src`, 'utils.test.ts', `import { describe, it, expect } from 'vitest'
import { paginate, formatDate, slugify, truncate } from './utils.js'

describe('paginate', () => {
  it('returns correct page', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(paginate(items, 1, 3)).toEqual([1, 2, 3])
    expect(paginate(items, 2, 3)).toEqual([4, 5, 6])
    expect(paginate(items, 3, 3)).toEqual([7, 8, 9])
  })

  it('handles last page correctly', () => {
    const items = [1, 2, 3, 4, 5]
    expect(paginate(items, 2, 3)).toEqual([4, 5])
  })
})

describe('formatDate', () => {
  it('formats date correctly', () => {
    expect(formatDate('2024-01-15T10:00:00Z')).toBe('2024-01-15')
  })
})

describe('slugify', () => {
  it('converts to slug', () => {
    expect(slugify('Hello World!')).toBe('hello-world')
  })
})

describe('truncate', () => {
  it('truncates long strings', () => {
    expect(truncate('Hello World', 8)).toBe('Hello...')
    expect(truncate('Hi', 8)).toBe('Hi')
  })
})
`)
}

// ─── packages/api ────────────────────────────────────────────────────────────

async function writePackageApi(dir: string, withTypeBug: boolean, withMissingFeatures: boolean): Promise<void> {
  const pkg = resolve(dir, 'packages/api')
  await ensureDir(`${pkg}/src/routes`)

  await write(pkg, 'package.json', JSON.stringify({
    name: '@acme/api',
    version: '1.0.0',
    type: 'module',
    dependencies: {
      express: '^4.18.2',
      '@acme/core': 'workspace:*',
    },
  }, null, 2))

  await write(pkg, 'tsconfig.json', JSON.stringify({
    extends: '../../tsconfig.json',
    compilerOptions: { outDir: './dist', rootDir: './src' },
    references: [{ path: '../core' }],
    include: ['src/**/*'],
  }, null, 2))

  // users.ts — 含 type_error：返回类型错误 + 缺少分页功能
  const getUsersReturnType = withTypeBug
    ? `// BUG: should return { data: User[], total: number } but returns User[]`
    : `// Returns paginated result`

  await write(`${pkg}/src/routes`, 'users.ts', `import { Router } from 'express'
import { paginate, NotFoundError, ValidationError } from '@acme/core'

interface User {
  id: number
  name: string
  email: string
  role: 'admin' | 'user'
  createdAt: string
}

// In-memory store (would be a DB in production)
const users: User[] = [
  { id: 1, name: 'Alice Admin', email: 'alice@acme.com', role: 'admin', createdAt: '2024-01-01' },
  { id: 2, name: 'Bob User', email: 'bob@acme.com', role: 'user', createdAt: '2024-01-02' },
  { id: 3, name: 'Carol User', email: 'carol@acme.com', role: 'user', createdAt: '2024-01-03' },
]

export const usersRouter = Router()

// GET /users
usersRouter.get('/', (req, res) => {
  ${getUsersReturnType}
  const page = parseInt(req.query['page'] as string ?? '1')
  const pageSize = parseInt(req.query['pageSize'] as string ?? '10')

  ${withTypeBug
    ? `// BUG: returns raw array instead of { data, total, page, pageSize }\n  const result = paginate(users, page, pageSize)\n  res.json(result)`
    : `const data = paginate(users, page, pageSize)\n  res.json({ data, total: users.length, page, pageSize })`}
})

// GET /users/:id
usersRouter.get('/:id', (req, res, next) => {
  const id = parseInt(req.params['id']!)
  const user = users.find(u => u.id === id)
  if (!user) {
    return next(new NotFoundError('User', id))
  }
  res.json(user)
})

// POST /users
usersRouter.post('/', (req, res, next) => {
  const { name, email, role } = req.body as Partial<User>
  if (!name || !email) {
    return next(new ValidationError('name and email are required'))
  }
  const newUser: User = {
    id: users.length + 1,
    name,
    email,
    role: role ?? 'user',
    createdAt: new Date().toISOString().split('T')[0]!,
  }
  users.push(newUser)
  res.status(201).json(newUser)
})

${withMissingFeatures ? `// TODO: PUT /users/:id — update user
// TODO: DELETE /users/:id — delete user
// TODO: GET /users/:id/posts — get user's posts
` : `
// PUT /users/:id
usersRouter.put('/:id', (req, res, next) => {
  const id = parseInt(req.params['id']!)
  const idx = users.findIndex(u => u.id === id)
  if (idx === -1) return next(new NotFoundError('User', id))
  users[idx] = { ...users[idx]!, ...req.body as Partial<User>, id }
  res.json(users[idx])
})

// DELETE /users/:id
usersRouter.delete('/:id', (req, res, next) => {
  const id = parseInt(req.params['id']!)
  const idx = users.findIndex(u => u.id === id)
  if (idx === -1) return next(new NotFoundError('User', id))
  users.splice(idx, 1)
  res.status(204).send()
})
`}
`)

  await write(`${pkg}/src`, 'middleware.ts', `import { Request, Response, NextFunction } from 'express'
import { AppError } from '@acme/core'

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    })
    return
  }
  console.error('Unexpected error:', err)
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
}

export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  console.log(\`[\${new Date().toISOString()}] \${req.method} \${req.path}\`)
  next()
}
`)

  await write(`${pkg}/src`, 'index.ts', `import express from 'express'
import { usersRouter } from './routes/users.js'
import { errorHandler, requestLogger } from './middleware.js'

export function createApp() {
  const app = express()
  app.use(express.json())
  app.use(requestLogger)
  app.use('/api/users', usersRouter)
  app.use(errorHandler)
  return app
}
`)

  await write(`${pkg}/src`, 'users.test.ts', `import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from './index.js'

const app = createApp()

describe('GET /api/users', () => {
  it('returns paginated users', async () => {
    const res = await request(app).get('/api/users?page=1&pageSize=2')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    expect(res.body.total).toBe(3)
    expect(res.body.page).toBe(1)
  })
})

describe('GET /api/users/:id', () => {
  it('returns a user', async () => {
    const res = await request(app).get('/api/users/1')
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Alice Admin')
  })

  it('returns 404 for unknown user', async () => {
    const res = await request(app).get('/api/users/999')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/users', () => {
  it('creates a user', async () => {
    const res = await request(app).post('/api/users').send({ name: 'Dave', email: 'dave@acme.com' })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Dave')
  })

  it('validates required fields', async () => {
    const res = await request(app).post('/api/users').send({ name: 'No Email' })
    expect(res.status).toBe(422)
  })
})
`)
}

// ─── packages/auth ───────────────────────────────────────────────────────────

async function writePackageAuth(dir: string, withAsyncBug: boolean, withMissingFeatures: boolean): Promise<void> {
  const pkg = resolve(dir, 'packages/auth')
  await ensureDir(`${pkg}/src`)

  await write(pkg, 'package.json', JSON.stringify({
    name: '@acme/auth',
    version: '1.0.0',
    type: 'module',
    dependencies: {
      jsonwebtoken: '^9.0.2',
      bcryptjs: '^2.4.3',
      '@acme/core': 'workspace:*',
    },
  }, null, 2))

  await write(pkg, 'tsconfig.json', JSON.stringify({
    extends: '../../tsconfig.json',
    compilerOptions: { outDir: './dist', rootDir: './src' },
    references: [{ path: '../core' }],
    include: ['src/**/*'],
  }, null, 2))

  // jwt.ts — 含 async_error：没有处理 token 过期
  await write(`${pkg}/src`, 'jwt.ts', `import jwt from 'jsonwebtoken'
import { UnauthorizedError } from '@acme/core'

const SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production'

export interface TokenPayload {
  userId: number
  email: string
  role: 'admin' | 'user'
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '24h' })
}

export function verifyToken(token: string): TokenPayload {
  ${withAsyncBug
    ? `// BUG: doesn't handle TokenExpiredError separately, throws generic error\n  try {\n    return jwt.verify(token, SECRET) as TokenPayload\n  } catch {\n    throw new UnauthorizedError('Invalid token')\n  }`
    : `try {\n    return jwt.verify(token, SECRET) as TokenPayload\n  } catch (err) {\n    if (err instanceof jwt.TokenExpiredError) {\n      throw new UnauthorizedError('Token expired')\n    }\n    throw new UnauthorizedError('Invalid token')\n  }`}
}

export function extractTokenFromHeader(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization header')
  }
  return authHeader.slice(7)
}
`)

  await write(`${pkg}/src`, 'password.ts', `import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function validatePasswordStrength(password: string): { valid: boolean; reason?: string } {
  if (password.length < 8) return { valid: false, reason: 'Password must be at least 8 characters' }
  if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Password must contain uppercase letter' }
  if (!/[0-9]/.test(password)) return { valid: false, reason: 'Password must contain a number' }
  return { valid: true }
}
`)

  if (withMissingFeatures) {
    await write(`${pkg}/src`, 'middleware.ts', `import { Request, Response, NextFunction } from 'express'
import { verifyToken, extractTokenFromHeader } from './jwt.js'
import { UnauthorizedError } from '@acme/core'

// TODO: implement requireAuth middleware
// Should: extract Bearer token, verify it, attach user to req
// Hint: extend Request type to include 'user: TokenPayload'
export function requireAuth(_req: Request, _res: Response, _next: NextFunction): void {
  throw new Error('Not implemented')
}

// TODO: implement requireRole middleware
// Should: check req.user.role === requiredRole
export function requireRole(_role: string) {
  return (_req: Request, _res: Response, _next: NextFunction): void => {
    throw new Error('Not implemented')
  }
}
`)
  } else {
    await write(`${pkg}/src`, 'middleware.ts', `import { Request, Response, NextFunction } from 'express'
import { verifyToken, extractTokenFromHeader, TokenPayload } from './jwt.js'

declare global {
  namespace Express {
    interface Request { user?: TokenPayload }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = extractTokenFromHeader(req.headers.authorization)
    req.user = verifyToken(token)
    next()
  } catch (err) {
    next(err)
  }
}

export function requireRole(role: 'admin' | 'user') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.user?.role !== role) {
      next(new Error('Forbidden'))
      return
    }
    next()
  }
}
`)
  }

  await write(`${pkg}/src`, 'index.ts', `export * from './jwt.js'\nexport * from './password.js'\nexport * from './middleware.js'\n`)

  await write(`${pkg}/src`, 'jwt.test.ts', `import { describe, it, expect } from 'vitest'
import { signToken, verifyToken, extractTokenFromHeader } from './jwt.js'
import { UnauthorizedError } from '@acme/core'

describe('JWT', () => {
  const payload = { userId: 1, email: 'test@test.com', role: 'user' as const }

  it('signs and verifies a token', () => {
    const token = signToken(payload)
    const verified = verifyToken(token)
    expect(verified.userId).toBe(1)
    expect(verified.email).toBe('test@test.com')
  })

  it('throws UnauthorizedError for invalid token', () => {
    expect(() => verifyToken('invalid')).toThrow(UnauthorizedError)
  })

  it('extracts token from Bearer header', () => {
    const token = signToken(payload)
    expect(extractTokenFromHeader(\`Bearer \${token}\`)).toBe(token)
  })

  it('throws for missing header', () => {
    expect(() => extractTokenFromHeader(undefined)).toThrow(UnauthorizedError)
  })
})
`)
}

// ─── packages/client ─────────────────────────────────────────────────────────

async function writePackageClient(dir: string, withBug: boolean): Promise<void> {
  const pkg = resolve(dir, 'packages/client')
  await ensureDir(`${pkg}/src`)

  await write(pkg, 'package.json', JSON.stringify({
    name: '@acme/client',
    version: '1.0.0',
    type: 'module',
    dependencies: { '@acme/core': 'workspace:*' },
  }, null, 2))

  await write(pkg, 'tsconfig.json', JSON.stringify({
    extends: '../../tsconfig.json',
    compilerOptions: { outDir: './dist', rootDir: './src' },
    references: [{ path: '../core' }],
    include: ['src/**/*'],
  }, null, 2))

  await write(`${pkg}/src`, 'client.ts', `import { AppError } from '@acme/core'

export interface ClientOptions {
  baseUrl: string
  token?: string
  timeout?: number
}

export class AcmeClient {
  private baseUrl: string
  private token?: string
  private timeout: number

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\\/$/, '')
    this.token = options.token
    this.timeout = options.timeout ?? 10000
  }

  setToken(token: string): void {
    this.token = token
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(\`\${this.baseUrl}\${path}\`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: \`Bearer \${this.token}\` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      ${withBug
        ? `// BUG: doesn't check res.ok before parsing, will throw on error responses
      const data = await res.json()
      return data as T`
        : `if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: 'Unknown error' } }))
        throw new AppError(
          (err as any).error?.message ?? 'Request failed',
          (err as any).error?.code ?? 'REQUEST_FAILED',
          res.status,
        )
      }
      return res.json() as Promise<T>`}
    } finally {
      clearTimeout(timer)
    }
  }

  async getUsers(page = 1, pageSize = 10) {
    return this.request<{ data: unknown[]; total: number }>('GET', \`/api/users?page=\${page}&pageSize=\${pageSize}\`)
  }

  async getUser(id: number) {
    return this.request<unknown>('GET', \`/api/users/\${id}\`)
  }

  async createUser(data: { name: string; email: string; role?: string }) {
    return this.request<unknown>('POST', '/api/users', data)
  }
}
`)

  await write(`${pkg}/src`, 'index.ts', `export * from './client.js'\n`)
}

// ─── apps/server ─────────────────────────────────────────────────────────────

async function writeAppServer(dir: string): Promise<void> {
  const app = resolve(dir, 'apps/server')
  await ensureDir(`${app}/src`)

  await write(app, 'package.json', JSON.stringify({
    name: '@acme/server',
    version: '1.0.0',
    type: 'module',
    scripts: { start: 'node dist/index.js', dev: 'tsx src/index.ts' },
    dependencies: {
      express: '^4.18.2',
      '@acme/api': 'workspace:*',
      '@acme/auth': 'workspace:*',
      '@acme/core': 'workspace:*',
    },
  }, null, 2))

  await write(app, 'tsconfig.json', JSON.stringify({
    extends: '../../tsconfig.json',
    compilerOptions: { outDir: './dist', rootDir: './src' },
    references: [
      { path: '../../packages/api' },
      { path: '../../packages/auth' },
      { path: '../../packages/core' },
    ],
    include: ['src/**/*'],
  }, null, 2))

  await write(`${app}/src`, 'index.ts', `import { createApp } from '@acme/api'

const PORT = parseInt(process.env['PORT'] ?? '3000', 10)
const app = createApp()

app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`)
})
`)
}

async function injectPerformanceBug(dir: string): Promise<void> {
  // N+1 query 模式
  await write(`${dir}/packages/api/src/routes`, 'posts.ts', `import { Router } from 'express'

interface Post { id: number; userId: number; title: string; body: string }
interface User { id: number; name: string }

const posts: Post[] = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1, userId: (i % 3) + 1,
  title: \`Post \${i + 1}\`,
  body: \`Body of post \${i + 1}\`,
}))

const users: User[] = [
  { id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Carol' },
]

export const postsRouter = Router()

// PERFORMANCE BUG: N+1 query — for each post, lookup user separately
postsRouter.get('/', (_req, res) => {
  const result = posts.map(post => {
    const user = users.find(u => u.id === post.userId) // N+1!
    return { ...post, author: user?.name }
  })
  res.json(result)
})
`)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

async function write(dir: string, filename: string, content: string): Promise<void> {
  await writeFile(resolve(dir, filename), content, 'utf-8')
}
