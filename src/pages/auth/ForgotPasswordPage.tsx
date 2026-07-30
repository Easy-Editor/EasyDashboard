import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth()
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setError(null)
    try {
      await requestPasswordReset(String(form.get('email') ?? ''))
      setSubmitted(true)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '暂时无法发送重置邮件，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className='ed-auth-form'>
        <p className='font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ed-cyan)]'>Recovery sent</p>
        <h1 className='mt-3 font-[var(--font-display)] text-[32px] font-medium tracking-[-0.035em]'>检查你的邮箱</h1>
        <p className='mt-3 text-[13px] leading-6 text-[var(--ed-ink-muted)]'>
          如果该邮箱已注册，你会收到密码重置链接。
        </p>
        <Button
          asChild
          className='mt-8 h-11 w-full rounded-[8px] border border-[#d9e7f2] bg-[#eef7ff] text-[#07111d] hover:bg-white'
        >
          <Link to='/login'>返回登录</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className='ed-auth-form'>
      <p className='font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ed-cyan)]'>Password recovery</p>
      <h1 className='mt-3 font-[var(--font-display)] text-[32px] font-medium tracking-[-0.035em]'>重置密码</h1>
      <p className='mt-2 text-[13px] leading-6 text-[var(--ed-ink-muted)]'>输入注册邮箱，我们会发送重置链接。</p>
      <form className='mt-9 space-y-5' onSubmit={handleSubmit}>
        <div className='space-y-2'>
          <Label htmlFor='forgot-email' className='text-xs text-[var(--ed-ink-soft)]'>
            邮箱
          </Label>
          <Input
            id='forgot-email'
            name='email'
            type='email'
            autoComplete='email'
            required
            placeholder='name@example.com'
            className='h-11 rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-3.5 text-[13px] text-[var(--ed-ink)] placeholder:text-[var(--ed-ink-faint)] focus-visible:border-[var(--ed-cyan)] focus-visible:ring-[var(--ed-cyan)]/25'
          />
        </div>
        {error ? (
          <p role='alert' className='border-l-2 border-[#ff7f8a] bg-[#35161d]/50 px-3 py-2 text-xs text-[#ffabb2]'>
            {error}
          </p>
        ) : null}
        <Button
          type='submit'
          disabled={submitting}
          className='h-11 w-full rounded-[8px] border border-[#d9e7f2] bg-[#eef7ff] text-[#07111d] hover:bg-white'
        >
          {submitting ? '正在发送…' : '发送重置链接'}
        </Button>
      </form>
      <Link
        to='/login'
        className='mt-7 block text-center text-xs text-[var(--ed-ink-muted)] hover:text-[var(--ed-cyan)]'
      >
        返回登录
      </Link>
    </div>
  )
}
