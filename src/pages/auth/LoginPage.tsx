import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowRight, Github } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { type AuthMessage, AuthStateNotice, readLoginRouteState } from './auth-state'

export function LoginPage() {
  const { signIn, startOAuth } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [submitting, setSubmitting] = useState(false)
  const requestedPathValue = (location.state as { from?: unknown } | null)?.from
  const requestedPath = typeof requestedPathValue === 'string' ? requestedPathValue : undefined
  const routeState = useMemo(
    () => readLoginRouteState(location.search, requestedPath),
    [location.search, requestedPath],
  )
  const [error, setError] = useState<AuthMessage | null>(() => routeState.authError)
  const returnTo = routeState.returnTo

  useEffect(() => {
    if (!routeState.hadAuthError) return
    navigate(
      {
        pathname: location.pathname,
        search: routeState.cleanedSearch,
      },
      {
        replace: true,
        state: location.state,
      },
    )
  }, [location.pathname, location.state, navigate, routeState.cleanedSearch, routeState.hadAuthError])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setError(null)
    try {
      await signIn({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      })
      navigate(returnTo, { replace: true })
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 401
          ? {
              title: '邮箱或密码不正确',
              description: '请检查输入后重新登录。',
            }
          : {
              title: '暂时无法登录',
              description: '请稍后重试，或选择第三方登录。',
            },
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='ed-auth-form'>
      <h1 className='font-[var(--font-display)] text-[36px] leading-tight font-medium tracking-[-0.04em]'>欢迎回来</h1>
      <p className='mt-2.5 text-[14px] leading-6 text-[var(--ed-ink-muted)]'>继续完成你的大屏作品。</p>
      <form className='mt-9 space-y-5' onSubmit={handleSubmit}>
        <div className='space-y-2.5'>
          <Label htmlFor='login-email' className='text-[13px] text-[var(--ed-ink-soft)]'>
            邮箱
          </Label>
          <Input
            id='login-email'
            name='email'
            type='email'
            autoComplete='email'
            required
            placeholder='name@example.com'
            className='h-12 rounded-[10px] border-[#2b3946] bg-[#0e151d] px-4 text-[14px] text-[var(--ed-ink)] placeholder:text-[#70818f] hover:border-[#3a4b59] focus-visible:border-[var(--ed-cyan)] focus-visible:ring-[3px] focus-visible:ring-[var(--ed-cyan)]/15'
          />
        </div>
        <div className='space-y-2.5'>
          <div className='flex items-center justify-between gap-4'>
            <Label htmlFor='login-password' className='text-[13px] text-[var(--ed-ink-soft)]'>
              密码
            </Label>
            <Link
              to='/forgot-password'
              className='rounded-[4px] text-[12px] text-[#9eb1bd] underline-offset-4 hover:text-[var(--ed-cyan)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]/70'
            >
              忘记密码？
            </Link>
          </div>
          <Input
            id='login-password'
            name='password'
            type='password'
            autoComplete='current-password'
            required
            minLength={8}
            placeholder='输入密码'
            className='h-12 rounded-[10px] border-[#2b3946] bg-[#0e151d] px-4 text-[14px] text-[var(--ed-ink)] placeholder:text-[#70818f] hover:border-[#3a4b59] focus-visible:border-[var(--ed-cyan)] focus-visible:ring-[3px] focus-visible:ring-[var(--ed-cyan)]/15'
          />
        </div>
        {error ? (
          <AuthStateNotice tone='error' title={error.title}>
            {error.description}
          </AuthStateNotice>
        ) : null}
        <Button
          type='submit'
          disabled={submitting}
          className='h-12 w-full rounded-[10px] border border-[#c9e5eb] bg-[#c9e5eb] text-[14px] font-semibold text-[#071015] shadow-none hover:border-[#e2f5f8] hover:bg-[#e2f5f8] hover:text-[#071015] active:translate-y-px focus-visible:ring-[var(--ed-cyan)]/55 focus-visible:ring-offset-[#0b1016]'
        >
          {submitting ? '正在登录…' : '登录'}
          <ArrowRight />
        </Button>
      </form>
      <div className='my-7 flex items-center gap-3' aria-hidden='true'>
        <span className='h-px flex-1 bg-[var(--ed-line)]' />
        <span className='text-[11px] text-[var(--ed-ink-faint)]'>其他登录方式</span>
        <span className='h-px flex-1 bg-[var(--ed-line)]' />
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <Button
          type='button'
          variant='outline'
          onClick={() => startOAuth('github', returnTo)}
          className='h-11 rounded-[10px] border-[#2b3946] bg-[#0e151d] text-[13px] text-[var(--ed-ink-soft)] shadow-none hover:border-[#455765] hover:bg-[#131d26] hover:text-[var(--ed-ink)] active:translate-y-px'
        >
          <Github className='size-3.5' />
          GitHub
        </Button>
        <Button
          type='button'
          variant='outline'
          onClick={() => startOAuth('google', returnTo)}
          className='h-11 rounded-[10px] border-[#2b3946] bg-[#0e151d] text-[13px] text-[var(--ed-ink-soft)] shadow-none hover:border-[#455765] hover:bg-[#131d26] hover:text-[var(--ed-ink)] active:translate-y-px'
        >
          <span className='font-mono text-[11px] font-bold text-[var(--ed-cyan)]'>G</span>
          Google
        </Button>
      </div>
      <p className='mt-8 text-center text-[13px] text-[var(--ed-ink-muted)]'>
        还没有账户？
        <Link
          to='/signup'
          className='ml-1 rounded-[4px] text-[var(--ed-ink)] underline-offset-4 hover:text-[var(--ed-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
        >
          创建账户
        </Link>
      </p>
    </div>
  )
}
