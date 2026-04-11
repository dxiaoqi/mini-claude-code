/**
 * GrepTool — 文件内容正则搜索工具
 *
 * 在文件或目录内按正则表达式搜索内容；优先使用 ripgrep（rg），不可用时回退到系统 grep。
 */
import { execFile } from 'node:child_process'
import { resolve, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for in file contents'),
  path: z.string().optional().describe('File or directory to search in (defaults to cwd)'),
  include: z.string().optional().describe('Glob pattern to filter files (e.g. "*.ts")'),
})

type Input = z.infer<typeof inputSchema>

interface GrepMatch {
  file: string
  line: number
  text: string
}

interface Output {
  matches: GrepMatch[]
  count: number
  pattern: string
  truncated: boolean
}

const MAX_MATCHES = 500

export const GrepTool: Tool<Input, Output> = {
  name: 'Grep',
  aliases: ['GrepTool'],
  description: 'Search file contents using regex. Uses ripgrep (rg) for speed. Supports file type filtering.',

  inputSchema,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(): Promise<PermissionResult> {
    return { behavior: 'allow' }
  },

  maxResultSizeChars: 100_000,

  async call(input, context): Promise<ToolResult<Output>> {
    const searchPath = input.path
      ? (isAbsolute(input.path) ? input.path : resolve(context.cwd, input.path))
      : context.cwd

    const args = [
      '--line-number',
      '--no-heading',
      '--color', 'never',
      '--max-count', '50',
      '--max-columns', '200',
    ]

    if (input.include) {
      args.push('--glob', input.include)
    }

    args.push('--', input.pattern, searchPath)

    return new Promise((res) => {
      execFile('rg', args, {
        maxBuffer: 1024 * 1024,
        timeout: 15_000,
      }, (err, stdout, stderr) => {
        if (err && !stdout) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return res(fallbackGrep(input, context))
          }
          return res({
            data: {
              matches: [],
              count: 0,
              pattern: input.pattern,
              truncated: false,
            },
          })
        }

        const lines = stdout.trim().split('\n').filter(Boolean)
        const matches: GrepMatch[] = []

        for (const line of lines) {
          if (matches.length >= MAX_MATCHES) break
          const match = line.match(/^(.+?):(\d+):(.*)$/)
          if (match) {
            matches.push({
              file: match[1],
              line: parseInt(match[2], 10),
              text: match[3],
            })
          }
        }

        res({
          data: {
            matches,
            count: matches.length,
            pattern: input.pattern,
            truncated: lines.length > MAX_MATCHES,
          },
        })
      })
    })
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.count === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `No matches found for pattern: ${output.pattern}`,
      }
    }

    const lines = output.matches.map(m => `${m.file}:${m.line}:${m.text}`)
    let content = lines.join('\n')
    if (output.truncated) {
      content += `\n\n[Results truncated at ${MAX_MATCHES} matches]`
    }

    return { tool_use_id: toolUseID, type: 'tool_result', content }
  },
}

async function fallbackGrep(input: { pattern: string; path?: string; include?: string }, context: { cwd: string }): Promise<ToolResult<Output>> {
  const searchPath = input.path
    ? (isAbsolute(input.path) ? input.path : resolve(context.cwd, input.path))
    : context.cwd

  const args = ['-rn', '--color=never']
  if (input.include) args.push(`--include=${input.include}`)
  args.push(input.pattern, searchPath)

  return new Promise((res) => {
    execFile('grep', args, {
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
    }, (err, stdout) => {
      const lines = (stdout || '').trim().split('\n').filter(Boolean)
      const matches: GrepMatch[] = []
      for (const line of lines) {
        if (matches.length >= MAX_MATCHES) break
        const match = line.match(/^(.+?):(\d+):(.*)$/)
        if (match) {
          matches.push({ file: match[1], line: parseInt(match[2], 10), text: match[3] })
        }
      }
      res({
        data: { matches, count: matches.length, pattern: input.pattern, truncated: lines.length > MAX_MATCHES },
      })
    })
  })
}
