import type { PermissionResult, Tool, ToolContext, ToolResult, ToolResultBlockParam } from '../../types.js'
import type { UserToolOutput, UserToolScriptDef } from './types.js'
import { zodFromUserParameters } from './zodFromUserParameters.js'

type Input = Record<string, unknown>

export function buildScriptTool(def: UserToolScriptDef): Tool<Input, UserToolOutput> {
  const inputSchema = zodFromUserParameters(def.parameters)

  return {
    name: def.name,
    description: def.description,
    inputSchema: inputSchema as typeof inputSchema & { _input: Input },

    isReadOnly() {
      return true
    },
    isConcurrencySafe() {
      return true
    },

    async checkPermissions(): Promise<PermissionResult> {
      return { behavior: 'allow' }
    },

    async call(input: Input, _ctx: ToolContext): Promise<ToolResult<UserToolOutput>> {
      try {
        const timeoutMs = 10_000
        const result = await Promise.race([
          def.execute(input),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('tool execute timeout')), timeoutMs),
          ),
        ])
        return { data: { ok: true, result } }
      } catch (e) {
        return { data: { ok: false, error: (e as Error).message } }
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
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: typeof output.result === 'string' ? output.result : JSON.stringify(output.result),
      }
    },
  }
}
