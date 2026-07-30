import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'

export const oauthFailureValues = [
  'oauth_callback_invalid',
  'oauth_exchange_failed',
  'oauth_provider_unsupported',
  'oauth_start_failed',
  'oauth_state_invalid',
] as const

export type OAuthFailure = (typeof oauthFailureValues)[number]

export type AuthMessage = {
  title: string
  description: string
}

const oauthFailureMessages: Record<OAuthFailure, AuthMessage> = {
  oauth_callback_invalid: {
    title: '登录返回信息不完整',
    description: '请重新选择 GitHub 或 Google 登录。',
  },
  oauth_exchange_failed: {
    title: '第三方登录未完成',
    description: '登录服务暂时没有完成验证，请稍后重试。',
  },
  oauth_provider_unsupported: {
    title: '该登录方式暂不可用',
    description: '请选择 GitHub、Google，或使用邮箱登录。',
  },
  oauth_start_failed: {
    title: '暂时无法发起第三方登录',
    description: '请稍后重新选择登录方式，或改用邮箱登录。',
  },
  oauth_state_invalid: {
    title: '登录验证已过期',
    description: '为保护账户安全，请重新选择登录方式。',
  },
}

function safeInternalPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  try {
    const parsed = new URL(value, 'https://internal.invalid')
    if (parsed.origin !== 'https://internal.invalid') return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

function readOAuthFailure(value: string | null): OAuthFailure | null {
  return oauthFailureValues.find(candidate => candidate === value) ?? null
}

export function readLoginRouteState(
  search: string,
  requestedPath?: string,
): {
  authError: AuthMessage | null
  cleanedSearch: string
  hadAuthError: boolean
  returnTo: string
} {
  const parameters = new URLSearchParams(search)
  const queryReturnTo = parameters.has('returnTo') ? safeInternalPath(parameters.get('returnTo')) : null
  const returnTo = queryReturnTo ?? safeInternalPath(requestedPath) ?? '/projects'
  const authErrorValue = parameters.get('authError')
  const authError = readOAuthFailure(authErrorValue)
  const cleaned = new URLSearchParams()
  if (returnTo !== '/projects') cleaned.set('returnTo', returnTo)

  return {
    authError: authError ? oauthFailureMessages[authError] : null,
    cleanedSearch: cleaned.size > 0 ? `?${cleaned.toString()}` : '',
    hadAuthError: parameters.has('authError'),
    returnTo,
  }
}

export function readResetPasswordRouteStatus(search: string): 'form' | 'invalid' | 'success' {
  const status = new URLSearchParams(search).get('status')
  if (status === 'ready') return 'form'
  if (status === 'success') return 'success'
  return 'invalid'
}

export function AuthStateNotice({
  children,
  title,
  tone,
}: {
  children: ReactNode
  title: string
  tone: 'error' | 'success'
}) {
  const isError = tone === 'error'
  const Icon = isError ? AlertTriangle : CheckCircle2

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={
        isError
          ? 'border-l-2 border-[#ff7f8a] bg-[#35161d]/50 px-3.5 py-3 text-[#ffabb2]'
          : 'border-l-2 border-[var(--ed-cyan)] bg-[#0c2731]/60 px-3.5 py-3 text-[#b9f3ff]'
      }
    >
      <div className='flex items-start gap-2.5'>
        <Icon className='mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
        <div>
          <p className='text-xs font-medium text-current'>{title}</p>
          <div className='mt-1 text-[11px] leading-5 opacity-80'>{children}</div>
        </div>
      </div>
    </div>
  )
}
