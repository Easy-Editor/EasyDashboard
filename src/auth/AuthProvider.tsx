import { ApiError, apiRequest, jsonBody } from '@/api/client'
import type { SessionResponse, SessionUser } from '@/api/contracts'
import { type ReactNode, createContext, useCallback, useEffect, useMemo, useState } from 'react'

type Credentials = {
  email: string
  password: string
}

type SignUpResult = {
  confirmationRequired: boolean
}

type SignUpResponse = SessionResponse & {
  authenticated: boolean
}

type AuthContextValue = {
  user: SessionUser | null
  loading: boolean
  refreshSession: () => Promise<SessionUser | null>
  signIn: (credentials: Credentials) => Promise<void>
  signUp: (credentials: Credentials) => Promise<SignUpResult>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

const demoUser: SessionUser = {
  id: 'demo-user',
  email: 'demo@easydashboard.local',
}

const demoMode = import.meta.env.VITE_DEMO_MODE === 'true'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const applySession = useCallback((session: SessionResponse) => {
    setUser(session.user)
    return session.user
  }, [])

  const refreshSession = useCallback(async () => {
    if (demoMode) {
      setUser(demoUser)
      return demoUser
    }

    const session = await apiRequest<SessionResponse>('/api/auth/session')
    return applySession(session)
  }, [applySession])

  useEffect(() => {
    let active = true

    const loadSession = async () => {
      try {
        const nextUser = await refreshSession()
        if (!active) return
        setUser(nextUser)
      } catch {
        if (!active) return
        setUser(null)
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadSession()

    return () => {
      active = false
    }
  }, [refreshSession])

  const signIn = useCallback(
    async (credentials: Credentials) => {
      if (demoMode) {
        setUser({ ...demoUser, email: credentials.email })
        return
      }

      const session = await apiRequest<SessionResponse>('/api/auth/sign-in', {
        method: 'POST',
        body: jsonBody(credentials),
      })
      applySession(session)
    },
    [applySession],
  )

  const signUp = useCallback(
    async (credentials: Credentials) => {
      if (demoMode) {
        setUser({ ...demoUser, email: credentials.email })
        return { confirmationRequired: false }
      }

      const result = await apiRequest<SignUpResponse>('/api/auth/sign-up', {
        method: 'POST',
        body: jsonBody(credentials),
      })
      applySession({ user: result.authenticated ? result.user : null })
      return { confirmationRequired: !result.authenticated }
    },
    [applySession],
  )

  const signOut = useCallback(async () => {
    if (!demoMode) {
      try {
        await apiRequest<void>('/api/auth/sign-out', { method: 'POST' })
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'REMOTE_SIGN_OUT_FAILED') throw error
        console.warn(error.message)
      } finally {
        setUser(null)
      }
      return
    }
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      refreshSession,
      signIn,
      signUp,
      signOut,
    }),
    [loading, refreshSession, signIn, signOut, signUp, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
