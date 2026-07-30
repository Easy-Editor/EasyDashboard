import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router'

export function ResetPasswordPage() {
  const { resetPassword } = useAuth()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setError(null)
    try {
      await resetPassword(String(form.get('password') ?? ''))
      navigate('/projects', { replace: true })
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.code === 'RECOVERY_SESSION_REQUIRED'
          ? '重置链接已失效，请重新发送'
          : '密码更新失败，请稍后重试',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='ed-auth-form'>
      <p className='font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ed-cyan)]'>Set credentials</p>
      <h1 className='mt-3 font-[var(--font-display)] text-[32px] font-medium tracking-[-0.035em]'>设置新密码</h1>
      <p className='mt-2 text-[13px] leading-6 text-[var(--ed-ink-muted)]'>新密码至少需要 8 位。</p>
      <form className='mt-9 space-y-5' onSubmit={handleSubmit}>
        <div className='space-y-2'>
          <Label htmlFor='reset-password' className='text-xs text-[var(--ed-ink-soft)]'>
            新密码
          </Label>
          <Input
            id='reset-password'
            name='password'
            type='password'
            autoComplete='new-password'
            minLength={8}
            required
            placeholder='至少 8 位'
            className='h-11 rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-3.5 text-[13px] text-[var(--ed-ink)] placeholder:text-[var(--ed-ink-faint)] focus-visible:border-[var(--ed-cyan)] focus-visible:ring-[var(--ed-cyan)]/25'
          />
        </div>
        {error ? (
          <p role='alert' className='border-l-2 border-[#ff7f8a] bg-[#35161d]/50 px-3 py-2 text-xs text-[#ffabb2]'>
            {error}{' '}
            {error.includes('失效') ? (
              <Link to='/forgot-password' className='text-[var(--ed-cyan)] underline underline-offset-2'>
                重新发送
              </Link>
            ) : null}
          </p>
        ) : null}
        <Button
          type='submit'
          disabled={submitting}
          className='h-11 w-full rounded-[8px] border border-[#d9e7f2] bg-[#eef7ff] text-[#07111d] hover:bg-white'
        >
          {submitting ? '正在更新…' : '更新密码'}
        </Button>
      </form>
    </div>
  )
}
