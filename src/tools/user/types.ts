/** 声明式 HTTP 工具定义（JSON 配置） */
export interface UserToolHttpDef {
  name: string
  description: string
  parameters: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean'
      description: string
      required?: boolean
      enum?: string[]
    }
  >
  executor: {
    type: 'http'
    url: string
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
    headers?: Record<string, string>
    body?: string | Record<string, unknown>
    responseType?: 'text' | 'json'
    timeoutMs?: number
  }
}

/** 脚本式工具的 JS 模块导出格式 */
export interface UserToolScriptDef {
  name: string
  description: string
  parameters: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean'
      description: string
      required?: boolean
      enum?: string[]
    }
  >
  execute: (params: Record<string, unknown>) => Promise<string>
}

export type UserToolDef = UserToolHttpDef | UserToolScriptDef

export type UserToolOutput =
  | { ok: true; result: unknown }
  | { ok: false; error: string }
