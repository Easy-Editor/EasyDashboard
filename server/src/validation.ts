import { z } from 'zod'

export const MAX_SCHEMA_BYTES = Math.floor(3.5 * 1024 * 1024)
export const MAX_SCHEMA_DEPTH = 64
export const MAX_SCHEMA_NODES = 50_000
export const MAX_SCHEMA_ENTRIES = 100_000
export const MAX_SCHEMA_STRING_BYTES = 256 * 1024
export const MAX_CANVAS_DIMENSION = 16_384

// EasyEditor owns the evolving inner schema. The API validates that it is a
// JSON object, enforces a transfer budget, and stores the whole document
// atomically rather than duplicating the framework's schema definition.
export const projectSchemaSchema = z.record(z.string(), z.unknown())
export type ProjectSchema = z.infer<typeof projectSchemaSchema>

export const credentialsSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(8).max(256),
})

export const projectIdSchema = z.uuid()
export const slugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function assertCanvasDimensions(schema: ProjectSchema): void {
  const envelope = record(schema)
  const editorSchema = record(envelope?.editorSchema) ?? envelope
  const pages = Array.isArray(editorSchema?.componentsTree) ? editorSchema.componentsTree : []

  pages.forEach((page, pageIndex) => {
    const dashboard = record(record(page)?.$dashboard)
    const rect = record(dashboard?.rect)
    for (const axis of ['width', 'height'] as const) {
      const value = rect?.[axis]
      if (value === undefined) continue
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > MAX_CANVAS_DIMENSION
      ) {
        throw new ValidationError(
          'INVALID_CANVAS_DIMENSION',
          `Page ${pageIndex + 1} canvas ${axis} must be an integer between 1 and ${MAX_CANVAS_DIMENSION}`,
        )
      }
    }
  })
}

export function assertSchemaBudget(schema: ProjectSchema): void {
  const bytes = Buffer.byteLength(JSON.stringify(schema), 'utf8')
  if (bytes > MAX_SCHEMA_BYTES) {
    throw new ValidationError('SCHEMA_TOO_LARGE', `Serialized schema exceeds ${MAX_SCHEMA_BYTES} bytes`)
  }

  let nodes = 0
  let entries = 0
  const stack: Array<{ value: unknown; depth: number }> = [{ value: schema, depth: 0 }]

  while (stack.length > 0) {
    const item = stack.pop()
    if (!item) break
    nodes += 1
    if (nodes > MAX_SCHEMA_NODES) {
      throw new ValidationError('SCHEMA_TOO_COMPLEX', `Schema exceeds ${MAX_SCHEMA_NODES} JSON nodes`)
    }
    if (item.depth > MAX_SCHEMA_DEPTH) {
      throw new ValidationError('SCHEMA_TOO_DEEP', `Schema exceeds ${MAX_SCHEMA_DEPTH} levels`)
    }
    if (typeof item.value === 'string') {
      if (Buffer.byteLength(item.value, 'utf8') > MAX_SCHEMA_STRING_BYTES) {
        throw new ValidationError('SCHEMA_STRING_TOO_LARGE', `A schema string exceeds ${MAX_SCHEMA_STRING_BYTES} bytes`)
      }
      continue
    }
    if (Array.isArray(item.value)) {
      entries += item.value.length
      for (const child of item.value) stack.push({ value: child, depth: item.depth + 1 })
    } else if (item.value && typeof item.value === 'object') {
      const values = Object.values(item.value)
      entries += values.length
      for (const child of values) stack.push({ value: child, depth: item.depth + 1 })
    }
    if (entries > MAX_SCHEMA_ENTRIES) {
      throw new ValidationError('SCHEMA_TOO_COMPLEX', `Schema exceeds ${MAX_SCHEMA_ENTRIES} map entries`)
    }
  }
}

export class ValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
