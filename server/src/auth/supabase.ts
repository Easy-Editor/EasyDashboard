import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { AppEnv } from '../env.js'
import type { AuthService, AuthSession, PublicUser } from '../types.js'

function toUser(user: { id: string; email?: string | null }): PublicUser {
  return { id: user.id, email: user.email ?? null }
}

function toSession(session: {
  access_token: string
  refresh_token: string
  expires_at?: number
  user: { id: string; email?: string | null }
}): AuthSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
    user: toUser(session.user),
  }
}

export function createSupabaseAuthService(env: AppEnv): AuthService {
  // This is a per-process optimization only. Cross-instance concurrency is
  // handled by Supabase's refresh-token reuse semantics, not a distributed lock.
  const inFlightRefreshes = new Map<string, Promise<AuthSession>>()
  const client = () =>
    createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

  return {
    async signUp(email, password) {
      const { data, error } = await client().auth.signUp({ email, password })
      if (error || !data.user) throw new Error(error?.message ?? 'Supabase sign-up returned no user')
      return {
        user: toUser(data.user),
        session: data.session ? toSession(data.session) : null,
      }
    },
    async signIn(email, password) {
      const { data, error } = await client().auth.signInWithPassword({ email, password })
      if (error || !data.session) throw new Error(error?.message ?? 'Supabase sign-in returned no session')
      return toSession(data.session)
    },
    async refresh(refreshToken) {
      const refreshKey = createHash('sha256').update(refreshToken).digest('base64url')
      const existing = inFlightRefreshes.get(refreshKey)
      if (existing) return existing
      const refresh = (async () => {
        const { data, error } = await client().auth.refreshSession({ refresh_token: refreshToken })
        if (error || !data.session) throw new Error(error?.message ?? 'Supabase refresh returned no session')
        return toSession(data.session)
      })()
      inFlightRefreshes.set(refreshKey, refresh)
      try {
        return await refresh
      } finally {
        if (inFlightRefreshes.get(refreshKey) === refresh) inFlightRefreshes.delete(refreshKey)
      }
    },
    async getUser(accessToken) {
      const { data, error } = await client().auth.getUser(accessToken)
      if (error || !data.user) return null
      return toUser(data.user)
    },
    async signOut(_accessToken, refreshToken) {
      if (!refreshToken) return
      const auth = client().auth
      const { data, error: refreshError } = await auth.refreshSession({ refresh_token: refreshToken })
      if (refreshError || !data.session) {
        throw new Error(refreshError?.message ?? 'Supabase sign-out could not restore the remote session')
      }
      const { error } = await auth.signOut()
      if (error) throw error
    },
  }
}
