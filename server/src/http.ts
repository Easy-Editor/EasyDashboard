import type { Context } from 'hono'
import type { z } from 'zod'

export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 500 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let json: unknown
  try {
    json = await c.req.json()
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON')
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    throw new ApiError(422, 'VALIDATION_FAILED', result.error.issues.map(issue => issue.message).join('; '))
  }
  return result.data
}
