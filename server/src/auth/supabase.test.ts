import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env.js'
import { createSupabaseAuthService } from './supabase.js'

const supabase = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      refreshSession: supabase.refreshSession,
      signOut: supabase.signOut,
    },
  }),
}))

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable',
} as AppEnv

describe('Supabase auth sign-out', () => {
  beforeEach(() => {
    supabase.refreshSession.mockReset()
    supabase.signOut.mockReset()
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
