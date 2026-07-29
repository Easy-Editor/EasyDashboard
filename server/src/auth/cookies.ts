import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AuthSession } from '../types.js'

export const ACCESS_COOKIE = '__Host-ed-access-token'
export const REFRESH_COOKIE = '__Host-ed-refresh-token'

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax' as const,
  path: '/',
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
