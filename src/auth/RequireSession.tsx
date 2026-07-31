import { LogoLoading } from '@/components/common/logo-loading'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from './useAuth'

export function RequireSession({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth()
  const location = useLocation()

  if (loading) {
    return <LogoLoading />
  }

  if (!user) {
    return <Navigate to='/login' replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />
  }

  return children
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth()

  if (loading) {
    return <LogoLoading />
  }

  if (user) {
    return <Navigate to='/' replace />
  }

  return children
}
