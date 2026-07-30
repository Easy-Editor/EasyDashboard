import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { AppEnv } from '../env.js'
import type { AuthService, AuthSession, OAuthProvider, PublicUser } from '../types.js'

const PKCE_STORAGE_KEY = 'easy-dashboard-auth'
const PKCE_VERIFIER_KEY = `${PKCE_STORAGE_KEY}-code-verifier`

function createPkceStorage(codeVerifier?: string) {
  const values = new Map<string, string>()
  if (codeVerifier) values.set(PKCE_VERIFIER_KEY, codeVerifier)
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    },
    getCodeVerifier() {
      return values.get(PKCE_VERIFIER_KEY) ?? null
    },
  }
}

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
  const pkceClient = (codeVerifier?: string) => {
    const pkce = createPkceStorage(codeVerifier)
    return {
      auth: createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          // Supabase only uses a custom storage adapter when persistSession is
          // enabled. This adapter is request-local memory; no session or PKCE
          // secret is exposed to browser storage.
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          flowType: 'pkce',
          storageKey: PKCE_STORAGE_KEY,
          storage: pkce.storage,
        },
      }).auth,
      getCodeVerifier: pkce.getCodeVerifier,
    }
  }

  function requireVerifier(getCodeVerifier: () => string | null): string {
    const codeVerifier = getCodeVerifier()
    if (!codeVerifier) throw new Error('Supabase PKCE flow returned no code verifier')
    return codeVerifier
  }

  async function exchangeCode(code: string, codeVerifier: string): Promise<AuthSession> {
    const { auth } = pkceClient(codeVerifier)
    const { data, error } = await auth.exchangeCodeForSession(code)
    if (error || !data.session) throw new Error(error?.message ?? 'Supabase code exchange returned no session')
    return toSession(data.session)
  }

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
    async startOAuth(provider: OAuthProvider, redirectTo: string) {
      const { auth, getCodeVerifier } = pkceClient()
      const { data, error } = await auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      })
      if (error || !data.url) throw new Error(error?.message ?? 'Supabase OAuth returned no redirect URL')
      return { url: data.url, codeVerifier: requireVerifier(getCodeVerifier) }
    },
    exchangeCode,
    async requestPasswordReset(email, redirectTo) {
      const { auth, getCodeVerifier } = pkceClient()
      const { error } = await auth.resetPasswordForEmail(email, { redirectTo })
      if (error) throw error
      return { codeVerifier: requireVerifier(getCodeVerifier) }
    },
    async updatePassword(accessToken, refreshToken, password) {
      const auth = client().auth
      const { data, error: sessionError } = await auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      if (sessionError || !data.session) {
        throw new Error(sessionError?.message ?? 'Supabase password update could not restore the session')
      }
      const { error } = await auth.updateUser({ password })
      if (error) throw error
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
