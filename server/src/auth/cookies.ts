import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AuthSession } from '../types.js'

export const ACCESS_COOKIE = '__Host-ed-access-token'
export const REFRESH_COOKIE = '__Host-ed-refresh-token'
export const OAUTH_STATE_COOKIE = '__Host-ed-oauth-state'
export const OAUTH_VERIFIER_COOKIE = '__Host-ed-oauth-verifier'
export const OAUTH_RETURN_TO_COOKIE = '__Host-ed-oauth-return-to'
export const RECOVERY_VERIFIER_COOKIE = '__Host-ed-recovery-verifier'
export const RECOVERY_CODE_COOKIE = '__Host-ed-recovery-code'

const localCookieNames = {
  access: 'ed-access-token',
  refresh: 'ed-refresh-token',
  oauthState: 'ed-oauth-state',
  oauthVerifier: 'ed-oauth-verifier',
  oauthReturnTo: 'ed-oauth-return-to',
  recoveryVerifier: 'ed-recovery-verifier',
  recoveryCode: 'ed-recovery-code',
} as const

const secureCookieNames = {
  access: ACCESS_COOKIE,
  refresh: REFRESH_COOKIE,
  oauthState: OAUTH_STATE_COOKIE,
  oauthVerifier: OAUTH_VERIFIER_COOKIE,
  oauthReturnTo: OAUTH_RETURN_TO_COOKIE,
  recoveryVerifier: RECOVERY_VERIFIER_COOKIE,
  recoveryCode: RECOVERY_CODE_COOKIE,
} as const

function cookiePolicy(c: Context) {
  const secure = (c.var as { authCookieSecure?: boolean }).authCookieSecure ?? true
  return {
    names: secure ? secureCookieNames : localCookieNames,
    options: {
      httpOnly: true,
      secure,
      sameSite: 'Lax' as const,
      path: '/',
    },
  }
}

export function readAuthCookies(c: Context): { accessToken?: string; refreshToken?: string } {
  const { names } = cookiePolicy(c)
  return {
    accessToken: getCookie(c, names.access),
    refreshToken: getCookie(c, names.refresh),
  }
}

export function writeAuthCookies(c: Context, session: AuthSession): void {
  const { names, options } = cookiePolicy(c)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const accessMaxAge = session.expiresAt ? Math.max(1, session.expiresAt - nowSeconds) : 3600
  setCookie(c, names.access, session.accessToken, { ...options, maxAge: accessMaxAge })
  setCookie(c, names.refresh, session.refreshToken, { ...options, maxAge: 60 * 60 * 24 * 30 })
}

export function clearAuthCookies(c: Context): void {
  const { names, options } = cookiePolicy(c)
  deleteCookie(c, names.access, options)
  deleteCookie(c, names.refresh, options)
}

export function writeOAuthFlowCookies(
  c: Context,
  flow: { state: string; codeVerifier: string; returnTo: string },
): void {
  const { names, options } = cookiePolicy(c)
  const flowOptions = { ...options, maxAge: 10 * 60 }
  setCookie(c, names.oauthState, flow.state, flowOptions)
  setCookie(c, names.oauthVerifier, flow.codeVerifier, flowOptions)
  setCookie(c, names.oauthReturnTo, flow.returnTo, flowOptions)
}

export function readOAuthFlowCookies(c: Context): {
  state?: string
  codeVerifier?: string
  returnTo?: string
} {
  const { names } = cookiePolicy(c)
  return {
    state: getCookie(c, names.oauthState),
    codeVerifier: getCookie(c, names.oauthVerifier),
    returnTo: getCookie(c, names.oauthReturnTo),
  }
}

export function clearOAuthFlowCookies(c: Context): void {
  const { names, options } = cookiePolicy(c)
  deleteCookie(c, names.oauthState, options)
  deleteCookie(c, names.oauthVerifier, options)
  deleteCookie(c, names.oauthReturnTo, options)
}

export function writeRecoveryVerifierCookie(c: Context, codeVerifier: string): void {
  const { names, options } = cookiePolicy(c)
  setCookie(c, names.recoveryVerifier, codeVerifier, { ...options, maxAge: 10 * 60 })
}

export function readRecoveryVerifierCookie(c: Context): string | undefined {
  return getCookie(c, cookiePolicy(c).names.recoveryVerifier)
}

export function clearRecoveryVerifierCookie(c: Context): void {
  const { names, options } = cookiePolicy(c)
  deleteCookie(c, names.recoveryVerifier, options)
}

export function writeRecoveryCodeCookie(c: Context, code: string): void {
  const { names, options } = cookiePolicy(c)
  setCookie(c, names.recoveryCode, code, { ...options, maxAge: 10 * 60 })
}

export function readRecoveryCodeCookie(c: Context): string | undefined {
  return getCookie(c, cookiePolicy(c).names.recoveryCode)
}

export function clearRecoveryCodeCookie(c: Context): void {
  const { names, options } = cookiePolicy(c)
  deleteCookie(c, names.recoveryCode, options)
}
