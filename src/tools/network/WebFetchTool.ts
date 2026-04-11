/**
 * WebFetchTool — 网页抓取工具
 *
 * 根据 URL 拉取远程内容，并将 HTML 转换为可读 Markdown，便于模型理解网页正文。
 */
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  url: z.string().url().describe('The URL to fetch'),
  maxLength: z.number().optional().describe('Maximum content length in characters (default: 50000)'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  url: string
  status: number
  contentType: string
  content: string
  truncated: boolean
}

export const WebFetchTool: Tool<Input, Output> = {
  name: 'WebFetch',
  aliases: ['WebFetchTool'],
  description: 'Fetch content from a URL and convert HTML to readable markdown. Use for retrieving web pages, API responses, or documentation.',

  inputSchema,
  shouldDefer: true,

  isReadOnly() { return true },
  isConcurrencySafe() { return true },

  async checkPermissions(input): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: `Allow fetching: ${input.url}`,
      suggestions: [{
        type: 'addRules',
        rules: [{ toolName: 'WebFetch' }],
        behavior: 'allow',
        destination: 'session',
      }],
    }
  },

  maxResultSizeChars: 100_000,

  async call(input): Promise<ToolResult<Output>> {
    const maxLength = input.maxLength || 50_000

    try {
      const response = await fetch(input.url, {
        headers: {
          'User-Agent': 'Mini-Claude-Code/0.1 (WebFetch)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        },
        signal: AbortSignal.timeout(15_000),
      })

      const contentType = response.headers.get('content-type') || 'unknown'
      const rawText = await response.text()

      let content: string
      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        content = await htmlToMarkdown(rawText)
      } else {
        content = rawText
      }

      const truncated = content.length > maxLength
      if (truncated) {
        content = content.slice(0, maxLength) + '\n\n[Content truncated]'
      }

      return {
        data: {
          url: input.url,
          status: response.status,
          contentType,
          content,
          truncated,
        },
      }
    } catch (err) {
      return {
        data: {
          url: input.url,
          status: 0,
          contentType: 'error',
          content: `Fetch error: ${(err as Error).message}`,
          truncated: false,
        },
      }
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const header = `URL: ${output.url} (HTTP ${output.status}, ${output.contentType})`
    const content = output.status === 0
      ? output.content
      : `${header}\n\n${output.content}`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
      is_error: output.status === 0,
    }
  },
}

async function htmlToMarkdown(html: string): Promise<string> {
  try {
    const { default: TurndownService } = await import('turndown')
    const { parse } = await import('node-html-parser')

    const root = parse(html)

    // Remove non-content elements
    for (const sel of ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe']) {
      root.querySelectorAll(sel).forEach(el => el.remove())
    }

    const mainContent = root.querySelector('main') || root.querySelector('article') || root.querySelector('body') || root

    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    })

    return td.turndown(mainContent.innerHTML)
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
}
