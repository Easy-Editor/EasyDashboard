import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowRight } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { AuthStateNotice, readResetPasswordRouteStatus } from './auth-state'

type ResetPasswordView = 'form' | 'invalid' | 'success'

export function ResetPasswordResult({ status }: { status: Exclude<ResetPasswordView, 'form'> }) {
  const invalid = status === 'invalid'

  return (
    <div className='ed-auth-form' aria-labelledby='reset-password-result-title'>
      <p className='font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ed-cyan)]'>
        {invalid ? 'Recovery required' : 'Credentials updated'}
      </p>
      <h1
        id='reset-password-result-title'
        className='mt-3 font-[var(--font-display)] text-[32px] font-medium tracking-[-0.035em]'
      >
        {invalid ? '重置链接已失效' : '密码已更新'}
      </h1>
      <p className='mt-2 text-[13px] leading-6 text-[var(--ed-ink-muted)]'>
        {invalid ? '这个链接可能已经使用过，或已超过有效期。' : '新密码已经生效，可以继续进入项目空间。'}
      </p>
      <div className='mt-8'>
        <AuthStateNotice tone={invalid ? 'error' : 'success'} title={invalid ? '需要新的重置链接' : '账户凭据已更新'}>
          {invalid ? '重新发送邮件后，请使用最新邮件中的链接。' : '后续登录请使用刚刚设置的新密码。'}
        </AuthStateNotice>
      </div>
      <Button
        asChild
        className='mt-6 h-11 w-full rounded-[8px] border border-[#d9e7f2] bg-[#eef7ff] text-[#07111d] hover:bg-white'
      >
        <Link to={invalid ? '/forgot-password' : '/projects'}>
          {invalid ? '重新发送重置邮件' : '进入我的项目'}
          <ArrowRight />
        </Link>
      </Button>
      <p className='mt-5 text-center text-xs text-[var(--ed-ink-muted)]'>
        <Link
          to='/login'
          className='rounded-[4px] text-[var(--ed-ink-soft)] underline-offset-4 hover:text-[var(--ed-cyan)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
        >
          返回登录
        </Link>
      </p>
    </div>
  )
}

export function ResetPasswordPage() {
  const { resetPassword } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ResetPasswordView>(() => readResetPasswordRouteStatus(location.search))

  useEffect(() => {
    setView(readResetPasswordRouteStatus(location.search))
  }, [location.search])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setError(null)
    try {
      await resetPassword(String(form.get('password') ?? ''))
      setView('success')
      navigate('/reset-password?status=success', { replace: true })
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'RECOVERY_SESSION_REQUIRED') {
        setView('invalid')
        navigate('/reset-password?status=invalid', { replace: true })
      } else {
        setError('密码更新失败，请稍后重试。')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (view !== 'form') {
    return <ResetPasswordResult status={view} />
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
          <AuthStateNotice tone='error' title='密码暂未更新'>
            {error}{' '}
            <Link to='/forgot-password' className='text-[var(--ed-cyan)] underline underline-offset-2'>
              重新发送重置邮件
            </Link>
          </AuthStateNotice>
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
