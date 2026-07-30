import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AuthSession } from '../types.js'

export const ACCESS_COOKIE = '__Host-ed-access-token'
export const REFRESH_COOKIE = '__Host-ed-refresh-token'
export const OAUTH_STATE_COOKIE = '__Host-ed-oauth-state'
export const OAUTH_VERIFIER_COOKIE = '__Host-ed-oauth-verifier'
export const OAUTH_RETURN_TO_COOKIE = '__Host-ed-oauth-return-to'
export const RECOVERY_VERIFIER_COOKIE = '__Host-ed-recovery-verifier'

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax' as const,
  path: '/',
}

const flowCookieOptions = {
  ...cookieOptions,
  maxAge: 10 * 60,
}

export function readAuthCookies(c: Context): { accessToken?: string; refreshToken?: string } {
  return {
    accessToken: getCookie(c, ACCESS_COOKIE),
    refreshToken: getCookie(c, REFRESH_COOKIE),
  }
}

export function writeAuthCookies(c: Context, session: AuthSession): void {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const accessMaxAge = session.expiresAt ? Math.max(1, session.expiresAt - nowSeconds) : 3600
  setCookie(c, ACCESS_COOKIE, session.accessToken, { ...cookieOptions, maxAge: accessMaxAge })
  setCookie(c, REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, maxAge: 60 * 60 * 24 * 30 })
}

export function clearAuthCookies(c: Context): void {
  deleteCookie(c, ACCESS_COOKIE, cookieOptions)
  deleteCookie(c, REFRESH_COOKIE, cookieOptions)
}

export function writeOAuthFlowCookies(
  c: Context,
  flow: { state: string; codeVerifier: string; returnTo: string },
): void {
  setCookie(c, OAUTH_STATE_COOKIE, flow.state, flowCookieOptions)
  setCookie(c, OAUTH_VERIFIER_COOKIE, flow.codeVerifier, flowCookieOptions)
  setCookie(c, OAUTH_RETURN_TO_COOKIE, flow.returnTo, flowCookieOptions)
}

export function readOAuthFlowCookies(c: Context): {
  state?: string
  codeVerifier?: string
  returnTo?: string
} {
  return {
    state: getCookie(c, OAUTH_STATE_COOKIE),
    codeVerifier: getCookie(c, OAUTH_VERIFIER_COOKIE),
    returnTo: getCookie(c, OAUTH_RETURN_TO_COOKIE),
  }
}

export function clearOAuthFlowCookies(c: Context): void {
  deleteCookie(c, OAUTH_STATE_COOKIE, cookieOptions)
  deleteCookie(c, OAUTH_VERIFIER_COOKIE, cookieOptions)
  deleteCookie(c, OAUTH_RETURN_TO_COOKIE, cookieOptions)
}

export function writeRecoveryVerifierCookie(c: Context, codeVerifier: string): void {
  setCookie(c, RECOVERY_VERIFIER_COOKIE, codeVerifier, flowCookieOptions)
}

export function readRecoveryVerifierCookie(c: Context): string | undefined {
  return getCookie(c, RECOVERY_VERIFIER_COOKIE)
}

export function clearRecoveryVerifierCookie(c: Context): void {
  deleteCookie(c, RECOVERY_VERIFIER_COOKIE, cookieOptions)
}
