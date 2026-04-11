/**
 * utils/zodToJsonSchema.ts — Zod → JSON Schema 转换
 *
 * 将工具 inputSchema（Zod）序列化为 API 所需的 JSON Schema 子集。
 */
import type { z } from 'zod'

/**
 * Minimal Zod-to-JSON-Schema converter for tool input schemas.
 * Handles the common Zod types used in tool definitions.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return convertZodType(schema)
}

function convertZodType(schema: z.ZodType): Record<string, unknown> {
  const def = (schema as any)._def

  if (!def) {
    return { type: 'object' }
  }

  switch (def.typeName) {
    case 'ZodObject':
      return convertObject(def)
    case 'ZodString':
      return convertString(def)
    case 'ZodNumber':
      return { type: 'number', ...(def.description ? { description: def.description } : {}) }
    case 'ZodBoolean':
      return { type: 'boolean', ...(def.description ? { description: def.description } : {}) }
    case 'ZodArray':
      return {
        type: 'array',
        items: convertZodType(def.type),
        ...(def.description ? { description: def.description } : {}),
      }
    case 'ZodOptional':
      return convertZodType(def.innerType)
    case 'ZodDefault':
      return { ...convertZodType(def.innerType), default: def.defaultValue() }
    case 'ZodEnum':
      return { type: 'string', enum: def.values }
    case 'ZodUnion':
      return { oneOf: def.options.map(convertZodType) }
    case 'ZodLiteral':
      return { type: typeof def.value, const: def.value }
    case 'ZodRecord':
      return { type: 'object', additionalProperties: convertZodType(def.valueType) }
    case 'ZodEffects':
      return convertZodType(def.schema)
    default:
      return {}
  }
}

function convertObject(def: any): Record<string, unknown> {
  const shape = def.shape?.() || def.shape || {}
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = convertZodType(value as z.ZodType)
    const innerDef = (value as any)?._def
    if (innerDef?.typeName !== 'ZodOptional' && innerDef?.typeName !== 'ZodDefault') {
      required.push(key)
    }
  }

  const result: Record<string, unknown> = {
    type: 'object',
    properties,
  }

  if (required.length > 0) {
    result.required = required
  }

  const desc = def.description
  if (desc) {
    result.description = desc
  }

  return result
}

function convertString(def: any): Record<string, unknown> {
  const result: Record<string, unknown> = { type: 'string' }
  if (def.description) result.description = def.description
  if (def.checks) {
    for (const check of def.checks) {
      if (check.kind === 'min') result.minLength = check.value
      if (check.kind === 'max') result.maxLength = check.value
    }
  }
  return result
}
