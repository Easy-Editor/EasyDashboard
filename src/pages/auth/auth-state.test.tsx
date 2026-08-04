import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ResetPasswordResult } from './ResetPasswordPage'
import { AuthStateNotice, readLoginRouteState, readResetPasswordRouteStatus } from './auth-state'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

describe('authentication route states', () => {
  it('preserves a safe return path while consuming a stable OAuth failure', () => {
    const state = readLoginRouteState(
      '?authError=oauth_state_invalid&returnTo=%2Fprojects%2Fproject-1%2Feditor%3Fpage%3Doverview',
    )

    expect(state.authError).toEqual({
      title: '登录验证已过期',
      description: '为保护账户安全，请重新选择登录方式。',
    })
    expect(state.returnTo).toBe('/projects/project-1/editor?page=overview')
    expect(state.cleanedSearch).toBe('?returnTo=%2Fprojects%2Fproject-1%2Feditor%3Fpage%3Doverview')
    expect(state.hadAuthError).toBe(true)
  })

  it('drops external and protocol-relative redirects instead of reflecting them', () => {
    for (const returnTo of ['https://evil.example/steal', '//evil.example/steal', '/\\evil.example']) {
      const state = readLoginRouteState(
        `?authError=unknown_failure&returnTo=${encodeURIComponent(returnTo)}`,
        '/settings',
      )

      expect(state.authError).toBeNull()
      expect(state.returnTo).toBe('/settings')
      expect(state.cleanedSearch).toBe('?returnTo=%2Fsettings')
    }

    const withoutSafeHistory = readLoginRouteState(
      '?authError=oauth_start_failed&returnTo=https%3A%2F%2Fevil.example%2Fsteal',
    )
    expect(withoutSafeHistory.returnTo).toBe('/projects')
    expect(withoutSafeHistory.cleanedSearch).toBe('')
  })

  it('shows the password form only after the server marks the recovery callback ready', () => {
    expect(readResetPasswordRouteStatus('?status=ready')).toBe('form')
    expect(readResetPasswordRouteStatus('?status=invalid')).toBe('invalid')
    expect(readResetPasswordRouteStatus('?status=success')).toBe('success')
    expect(readResetPasswordRouteStatus('')).toBe('invalid')
  })
})

describe('authentication status accessibility', () => {
  it('announces actionable authentication failures assertively', () => {
    const html = renderToStaticMarkup(
      <AuthStateNotice tone='error' title='登录验证已过期'>
        请重新选择登录方式。
      </AuthStateNotice>,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-live="assertive"')
    expect(html).toContain('请重新选择登录方式')
    expect(html).toContain('border-[#ff7f8a]/30')
    expect(html).not.toContain('border-l-2')
  })

  it('keeps password reset success visible until the user enters their projects', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResetPasswordResult status='success' />
      </MemoryRouter>,
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('密码已更新')
    expect(html).toContain('进入我的项目')
    expect(html).toContain('href="/projects"')
  })

  it('shows an invalid recovery link before any form submission', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResetPasswordResult status='invalid' />
      </MemoryRouter>,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('重置链接已失效')
    expect(html).toContain('重新发送重置邮件')
    expect(html).toContain('href="/forgot-password"')
  })

  it('moves reset completion into the success view instead of navigating away immediately', async () => {
    const source = await readFile(path.join(currentDirectory, 'ResetPasswordPage.tsx'), 'utf8')

    expect(source).toContain("setView('success')")
    expect(source).toContain("navigate('/reset-password?status=success', { replace: true })")
    expect(source).not.toContain("navigate('/projects'")
  })
})
