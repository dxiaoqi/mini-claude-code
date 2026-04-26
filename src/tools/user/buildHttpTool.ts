import type { PermissionResult, Tool, ToolContext, ToolResult, ToolResultBlockParam } from '../../types.js'
import type { UserToolHttpDef, UserToolOutput } from './types.js'
import { zodFromUserParameters } from './zodFromUserParameters.js'

type Input = Record<string, unknown>

/** 替换 {{paramName}} 和 {{env.VAR}} 占位符 */
function interpolate(template: string, params: Record<string, unknown>): string {
  return template
    .replace(/\{\{env\.(\w+)\}\}/g, (_, key: string) => process.env[key] ?? '')
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(params[key] ?? ''))
}

function interpolateObj(
  obj: Record<string, string>,
  params: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, interpolate(v, params)]))
}

export function buildHttpTool(def: UserToolHttpDef): Tool<Input, UserToolOutput> {
  const inputSchema = zodFromUserParameters(def.parameters)

  return {
    name: def.name,
    description: def.description,
    inputSchema: inputSchema as typeof inputSchema & { _input: Input },

    isReadOnly() {
      return def.executor.method === 'GET'
    },
    isConcurrencySafe() {
      return true
    },

    async checkPermissions(): Promise<PermissionResult> {
      return { behavior: 'allow' }
    },

    async call(input: Input, _ctx: ToolContext): Promise<ToolResult<UserToolOutput>> {
      const { executor } = def
      const url = interpolate(executor.url, input)
      const headerRecord = executor.headers
        ? interpolateObj(executor.headers as Record<string, string>, input)
        : {}
      const timeoutMs = executor.timeoutMs ?? 10_000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const headers: Record<string, string> = { ...headerRecord }
        const fetchOptions: RequestInit = {
          method: executor.method,
          headers,
          signal: controller.signal,
        }

        if (['POST', 'PUT', 'PATCH'].includes(executor.method) && executor.body !== undefined) {
          const bodyStr =
            typeof executor.body === 'string'
              ? interpolate(executor.body, input)
              : interpolate(JSON.stringify(executor.body), input)
          fetchOptions.body = bodyStr
          const hasCt = Object.keys(headers).some(k => k.toLowerCase() === 'content-type')
          if (!hasCt) {
            headers['Content-Type'] = 'application/json'
          }
        }

        const res = await fetch(url, fetchOptions)
        const text = await res.text()

        if (!res.ok) {
          return {
            data: { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` },
          }
        }

        if (executor.responseType === 'text') {
          return { data: { ok: true, result: text } }
        }
        try {
          return { data: { ok: true, result: JSON.parse(text) } }
        } catch {
          return { data: { ok: true, result: text } }
        }
      } catch (e) {
        const msg = (e as Error).name === 'AbortError' ? `Request timed out after ${timeoutMs}ms` : (e as Error).message
        return { data: { ok: false, error: msg } }
      } finally {
        clearTimeout(timer)
      }
    },

    mapToolResultToToolResultBlockParam(output: UserToolOutput, toolUseID: string): ToolResultBlockParam {
      if (!output.ok) {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: output.error,
          is_error: true,
        }
      }
      const content =
        typeof output.result === 'string' ? output.result : JSON.stringify(output.result)
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content,
      }
    },
  }
}
