import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env.js'
import { createSupabaseAuthService } from './supabase.js'

const supabase = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  refreshSession: vi.fn(),
  setSession: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  storageVerifier: null as string | null,
  updateUser: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options?: { auth?: { storage?: Storage } }) => {
    const storage = options?.auth?.storage
    return {
      auth: {
        exchangeCodeForSession: async (code: string) => {
          supabase.storageVerifier = (await storage?.getItem('easy-dashboard-auth-code-verifier')) ?? null
          return supabase.exchangeCodeForSession(code)
        },
        resetPasswordForEmail: async (...args: unknown[]) => {
          await storage?.setItem('easy-dashboard-auth-code-verifier', 'recovery-verifier/PASSWORD_RECOVERY')
          return supabase.resetPasswordForEmail(...args)
        },
        refreshSession: supabase.refreshSession,
        setSession: supabase.setSession,
        signInWithOAuth: async (...args: unknown[]) => {
          await storage?.setItem('easy-dashboard-auth-code-verifier', 'generated-oauth-verifier')
          return supabase.signInWithOAuth(...args)
        },
        signOut: supabase.signOut,
        updateUser: supabase.updateUser,
      },
    }
  },
}))

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable',
} as AppEnv

describe('Supabase auth sign-out', () => {
  beforeEach(() => {
    supabase.exchangeCodeForSession.mockReset()
    supabase.resetPasswordForEmail.mockReset()
    supabase.refreshSession.mockReset()
    supabase.setSession.mockReset()
    supabase.signInWithOAuth.mockReset()
    supabase.signOut.mockReset()
    supabase.storageVerifier = null
    supabase.updateUser.mockReset()
  })

  it('initiates OAuth through Supabase PKCE and returns only the server-held verifier', async () => {
    supabase.signInWithOAuth.mockImplementation(async () => ({
      data: { url: 'https://example.supabase.co/auth/v1/authorize?provider=github' },
      error: null,
    }))

    const result = await createSupabaseAuthService(env).startOAuth(
      'github',
      'https://app.example.com/api/auth/oauth/callback?state=state',
    )

    expect(supabase.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: {
        redirectTo: 'https://app.example.com/api/auth/oauth/callback?state=state',
        skipBrowserRedirect: true,
      },
    })
    expect(result.url).toContain('provider=github')
    expect(result.codeVerifier).toBe('generated-oauth-verifier')
  })

  it('exchanges a PKCE code using the supplied verifier', async () => {
    supabase.exchangeCodeForSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'access',
          refresh_token: 'refresh',
          expires_at: 123,
          user: { id: 'user-id', email: 'user@example.com' },
        },
      },
      error: null,
    })

    await expect(createSupabaseAuthService(env).exchangeCode('code', 'verifier')).resolves.toMatchObject({
      accessToken: 'access',
      refreshToken: 'refresh',
    })
    expect(supabase.exchangeCodeForSession).toHaveBeenCalledWith('code')
    expect(supabase.storageVerifier).toBe('verifier')
  })

  it('starts password recovery with a server-held PKCE verifier', async () => {
    supabase.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    await expect(
      createSupabaseAuthService(env).requestPasswordReset(
        'user@example.com',
        'https://app.example.com/api/auth/password/callback',
      ),
    ).resolves.toEqual({ codeVerifier: 'recovery-verifier/PASSWORD_RECOVERY' })
    expect(supabase.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
      redirectTo: 'https://app.example.com/api/auth/password/callback',
    })
  })

  it('restores the recovery session before updating the password and returns current cookies', async () => {
    const session = {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_at: 123,
      user: { id: 'user-id', email: 'user@example.com' },
    }
    supabase.setSession.mockResolvedValue({ data: { session }, error: null })
    supabase.updateUser.mockResolvedValue({ data: { user: session.user }, error: null })

    await expect(
      createSupabaseAuthService(env).updatePassword('access', 'refresh', 'new-password'),
    ).resolves.toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    })
    expect(supabase.setSession).toHaveBeenCalledWith({
      access_token: 'access',
      refresh_token: 'refresh',
    })
    expect(supabase.updateUser).toHaveBeenCalledWith({ password: 'new-password' })
  })

  it('reports a failed remote revocation to the route', async () => {
    supabase.refreshSession.mockResolvedValue({ data: { session: {} }, error: null })
    supabase.signOut.mockResolvedValue({ error: new Error('revoke failed') })

    await expect(createSupabaseAuthService(env).signOut('access', 'refresh')).rejects.toThrow('revoke failed')
  })

  it('can revoke a session when only the refresh token cookie remains', async () => {
    supabase.refreshSession.mockResolvedValue({ data: { session: {} }, error: null })
    supabase.signOut.mockResolvedValue({ error: null })

    await expect(createSupabaseAuthService(env).signOut(undefined, 'refresh')).resolves.toBeUndefined()
    expect(supabase.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh' })
    expect(supabase.signOut).toHaveBeenCalledOnce()
  })

  it('does not claim revocation when restoring the session fails', async () => {
    supabase.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error('invalid session'),
    })

    await expect(createSupabaseAuthService(env).signOut('access', 'refresh')).rejects.toThrow('invalid session')
    expect(supabase.signOut).not.toHaveBeenCalled()
  })

  it('does not call Supabase when no refresh token exists', async () => {
    await expect(createSupabaseAuthService(env).signOut('access', undefined)).resolves.toBeUndefined()
    expect(supabase.refreshSession).not.toHaveBeenCalled()
    expect(supabase.signOut).not.toHaveBeenCalled()
  })
})
