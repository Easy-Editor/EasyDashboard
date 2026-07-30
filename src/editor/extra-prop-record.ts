export function normalizeExtraPropRecord<T extends Record<string, unknown>>(value: T | null | undefined): T {
  return value ?? ({} as T)
}
