import { createApp } from './app.js'
import { createSupabaseAuthService } from './auth/supabase.js'
import { createPgRepository } from './db/repository.js'
import { parseEnv } from './env.js'

export function createRuntimeApp() {
  const env = parseEnv()
  const repository = createPgRepository(env)
  return createApp({
    env,
    auth: createSupabaseAuthService(env),
    repository,
    provisionPersonalSpace: async user => {
      await repository.ensurePersonalSpace(user.id)
    },
  })
}
