export const MAX_PROJECT_SCHEMA_BYTES = Math.floor(3.5 * 1024 * 1024)
export const MAX_PROJECT_SCHEMA_DEPTH = 80
export const MAX_PROJECT_SCHEMA_VALUES = 50_000
export const MAX_PROJECT_SCHEMA_STRING_BYTES = 256 * 1024
export const MAX_PROJECT_SCHEMA_OBJECT_ENTRIES = 10_000

type SchemaBudgetCode =
  | 'SCHEMA_TOO_LARGE'
  | 'SCHEMA_TOO_DEEP'
  | 'SCHEMA_TOO_COMPLEX'
  | 'SCHEMA_STRING_TOO_LARGE'
  | 'SCHEMA_OBJECT_TOO_WIDE'

export class SchemaBudgetError extends Error {
  readonly code: SchemaBudgetCode

  constructor(code: SchemaBudgetCode, message: string) {
    super(message)
    this.name = 'SchemaBudgetError'
    this.code = code
  }
}

export function assertProjectSchemaBudget(schema: unknown): number {
  const encoded = new TextEncoder().encode(JSON.stringify(schema))

  if (encoded.byteLength > MAX_PROJECT_SCHEMA_BYTES) {
    throw new SchemaBudgetError(
      'SCHEMA_TOO_LARGE',
      `项目数据为 ${formatBytes(encoded.byteLength)}，超过 ${formatBytes(MAX_PROJECT_SCHEMA_BYTES)} 的保存上限。`,
    )
  }

  const stack: Array<{ value: unknown; depth: number }> = [{ value: schema, depth: 0 }]
  let valueCount = 0

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break

    valueCount += 1
    if (valueCount > MAX_PROJECT_SCHEMA_VALUES) {
      throw new SchemaBudgetError('SCHEMA_TOO_COMPLEX', '项目结构包含过多节点，无法安全保存。')
    }

    if (current.depth > MAX_PROJECT_SCHEMA_DEPTH) {
      throw new SchemaBudgetError('SCHEMA_TOO_DEEP', '项目结构嵌套过深，无法安全保存。')
    }

    if (typeof current.value === 'string') {
      const stringBytes = new TextEncoder().encode(current.value).byteLength
      if (stringBytes > MAX_PROJECT_SCHEMA_STRING_BYTES) {
        throw new SchemaBudgetError('SCHEMA_STRING_TOO_LARGE', '项目中存在过大的文本或代码字段。')
      }
      continue
    }

    if (Array.isArray(current.value)) {
      for (const child of current.value) {
        stack.push({ value: child, depth: current.depth + 1 })
      }
      continue
    }

    if (current.value && typeof current.value === 'object') {
      const values = Object.values(current.value)
      if (values.length > MAX_PROJECT_SCHEMA_OBJECT_ENTRIES) {
        throw new SchemaBudgetError('SCHEMA_OBJECT_TOO_WIDE', '项目中存在包含过多字段的对象。')
      }

      for (const child of values) {
        stack.push({ value: child, depth: current.depth + 1 })
      }
    }
  }

  return encoded.byteLength
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}
