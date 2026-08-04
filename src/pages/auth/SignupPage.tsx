import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowRight } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router'

export function SignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    setSubmitting(true)
    setError(null)
    try {
      const result = await signUp({
        email,
        password: String(form.get('password') ?? ''),
      })
      if (result.confirmationRequired) {
        setConfirmationEmail(email)
      } else {
        navigate('/projects', { replace: true })
      }
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '注册失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmationEmail) {
    return (
      <div className='ed-auth-form'>
        <h1 className='font-[var(--font-display)] text-[32px] font-medium tracking-[-0.035em]'>检查你的邮箱</h1>
        <p className='mt-3 text-[13px] leading-6 text-[var(--ed-ink-muted)]'>
          验证链接已发送至 <span className='text-[var(--ed-ink)]'>{confirmationEmail}</span>。完成验证后即可登录。
        </p>
        <Button
          asChild
          className='mt-8 h-11 w-full rounded-[8px] border border-[#315d76] bg-[#15344c] text-[#dff5ff] shadow-[0_12px_28px_rgba(2,16,27,.32)] hover:border-[#4b7f99] hover:bg-[#1b405b] hover:text-[#effbff] focus-visible:ring-[#6ddcf3]/50 focus-visible:ring-offset-[#090d13]'
        >
          <Link to='/login'>返回登录</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className='ed-auth-form'>
      <h1 className='font-[var(--font-display)] text-[32px] leading-tight font-medium tracking-[-0.035em]'>
        创建工作区账户
      </h1>
      <p className='mt-2 text-[13px] leading-6 text-[var(--ed-ink-muted)]'>保存画布、预览结果与发布记录。</p>
      <form className='mt-9 space-y-5' onSubmit={handleSubmit}>
        <div className='space-y-2'>
          <Label htmlFor='signup-email' className='text-xs text-[var(--ed-ink-soft)]'>
            邮箱
          </Label>
          <Input
            id='signup-email'
            name='email'
            type='email'
            autoComplete='email'
            required
            placeholder='name@example.com'
            className='h-11 rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-3.5 text-[13px] text-[var(--ed-ink)] placeholder:text-[var(--ed-ink-faint)] focus-visible:border-[var(--ed-cyan)] focus-visible:ring-[var(--ed-cyan)]/25'
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='signup-password' className='text-xs text-[var(--ed-ink-soft)]'>
            密码
          </Label>
          <Input
            id='signup-password'
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
          <p
            role='alert'
            className='rounded-[8px] border border-[#7c3440] bg-[#35161d]/50 px-3 py-2 text-xs text-[#ffabb2]'
          >
            {error}
          </p>
        ) : null}
        <Button
          type='submit'
          disabled={submitting}
          className='mt-1 h-11 w-full rounded-[8px] border border-[#315d76] bg-[#15344c] text-[#dff5ff] shadow-[0_12px_28px_rgba(2,16,27,.32)] hover:border-[#4b7f99] hover:bg-[#1b405b] hover:text-[#effbff] focus-visible:ring-[#6ddcf3]/50 focus-visible:ring-offset-[#090d13]'
        >
          {submitting ? '正在创建…' : '创建账户'}
          <ArrowRight />
        </Button>
      </form>
      <p className='mt-8 text-center text-xs text-[var(--ed-ink-muted)]'>
        已有账户？
        <Link
          to='/login'
          className='ml-1 rounded-[4px] text-[var(--ed-ink)] underline-offset-4 hover:text-[var(--ed-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
        >
          返回登录
        </Link>
      </p>
    </div>
  )
}
