import { z } from 'zod'
import type { UserToolHttpDef } from './types.js'

type ParamMap = UserToolHttpDef['parameters']

export function zodFromUserParameters(parameters: ParamMap): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, p] of Object.entries(parameters)) {
    let zt: z.ZodTypeAny
    if (p.type === 'string') {
      zt = p.enum?.length ? z.enum(p.enum as [string, ...string[]]) : z.string()
    } else if (p.type === 'number') {
      zt = z.number()
    } else {
      zt = z.boolean()
    }
    zt = zt.describe(p.description)
    if (!p.required) {
      zt = zt.optional()
    }
    shape[key] = zt
  }
  return z.object(shape)
}
