import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.url(),
  PUBLIC_VIEWER_ORIGIN: z.url().optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  DATABASE_URL: z.string().min(1),
})

export type AppEnv = z.infer<typeof envSchema>

export function parseEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(input)
  if (!result.success) {
    const details = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Invalid server environment: ${details}`)
  }
  return result.data
}
