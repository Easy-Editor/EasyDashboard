import { z } from 'zod'
import { compatibilityTupleSchema } from './agent/executor-contract.js'

const agentExecutorCompatibilityJsonSchema = z
  .string()
  .min(1)
  .transform((value, context) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(value) as unknown
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'must be valid JSON',
      })
      return z.NEVER
    }
    const compatibility = compatibilityTupleSchema.safeParse(parsed)
    if (!compatibility.success) {
      context.addIssue({
        code: 'custom',
        message: `must be a strict executor compatibility tuple: ${compatibility.error.issues
          .map(issue => issue.message)
          .join('; ')}`,
      })
      return z.NEVER
    }
    return compatibility.data
  })

const modelProfileEncryptionKeySchema = z.string().refine(value => {
  const decoded = Buffer.from(value, 'base64')
  return decoded.length === 32 && decoded.toString('base64').replaceAll('=', '') === value.trim().replaceAll('=', '')
}, 'must be base64 that decodes to exactly 32 bytes')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.url(),
  PUBLIC_VIEWER_ORIGIN: z.url().optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  DATABASE_URL: z.string().min(1),
  EASY_EDITOR_AGENT_BASE_URL: z.url().optional(),
  EASY_EDITOR_AGENT_API_KEY: z.string().min(1).optional(),
  EASY_EDITOR_AGENT_MODEL: z.string().trim().min(1).max(200).optional(),
  AGENT_MODEL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(10 * 60_000)
    .optional(),
  AGENT_ENABLE_LINKED_PIE_CHART_0_0_8: z
    .enum(['true', 'false'])
    .transform(value => value === 'true')
    .optional(),
  AGENT_TASK_LOOP_V1: z
    .enum(['true', 'false'])
    .transform(value => value === 'true')
    .optional(),
  AGENT_MODEL_PROFILE_ENCRYPTION_KEY: modelProfileEncryptionKeySchema.optional(),
  AGENT_EXECUTOR_GRANT_SECRET: z.string().min(32).optional(),
  AGENT_EXECUTOR_COMPATIBILITY_JSON: agentExecutorCompatibilityJsonSchema.optional(),
  AGENT_EXECUTOR_CLI_PATH: z.string().trim().min(1).optional(),
  AGENT_EXECUTOR_DASHBOARD_URL: z.url().optional(),
  AGENT_EXECUTOR_API_ORIGIN: z.url().optional(),
  AGENT_EXECUTOR_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(10 * 60_000)
    .optional(),
  AGENT_BILLING_MAX_USD_PER_1M_TOKENS: z.coerce.number().positive().max(10_000).optional(),
})

export type AppEnv = z.infer<typeof envSchema>

export function parseEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(input)
  if (!result.success) {
    const details = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Invalid server environment: ${details}`)
  }
  return { ...result.data, AGENT_TASK_LOOP_V1: result.data.AGENT_TASK_LOOP_V1 ?? true }
}
