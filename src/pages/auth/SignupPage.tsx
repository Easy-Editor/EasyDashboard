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
      <div>
        <p className='font-mono text-[10px] uppercase tracking-[0.16em] text-[#67C6D9]'>Verify email</p>
        <h1 className='mt-3 font-[Alibaba_PuHuiTi] text-[28px] font-medium tracking-[-0.02em]'>检查你的邮箱</h1>
        <p className='mt-3 text-sm leading-6 text-[#7F8B95]'>
          验证链接已发送至 <span className='text-[#D6DDE2]'>{confirmationEmail}</span>。完成验证后即可登录。
        </p>
        <Button asChild className='mt-8 h-11 w-full rounded-[6px] bg-[#F1F5F7] text-[#080A0D] hover:bg-white'>
          <Link to='/login'>返回登录</Link>
        </Button>
      </div>
    )
  }

  return (
    <div>
      <p className='font-mono text-[10px] uppercase tracking-[0.16em] text-[#67C6D9]'>Create account</p>
      <h1 className='mt-3 font-[Alibaba_PuHuiTi] text-[28px] font-medium tracking-[-0.02em]'>创建工作区账户</h1>
      <p className='mt-2 text-sm leading-6 text-[#7F8B95]'>账户用于保存项目和管理发布记录。</p>
      <form className='mt-8 space-y-4' onSubmit={handleSubmit}>
        <div className='space-y-2'>
          <Label htmlFor='signup-email' className='text-[#D6DDE2]'>
            邮箱
          </Label>
          <Input
            id='signup-email'
            name='email'
            type='email'
            autoComplete='email'
            required
            placeholder='name@example.com'
            className='h-11 rounded-[6px] border-[#2A333D] bg-[#0F1318] text-[#F1F5F7] placeholder:text-[#596671] focus-visible:border-[#67C6D9] focus-visible:ring-[#67C6D9]/30'
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='signup-password' className='text-[#D6DDE2]'>
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
            className='h-11 rounded-[6px] border-[#2A333D] bg-[#0F1318] text-[#F1F5F7] placeholder:text-[#596671] focus-visible:border-[#67C6D9] focus-visible:ring-[#67C6D9]/30'
          />
        </div>
        {error ? (
          <p role='alert' className='text-sm text-[#E98D8D]'>
            {error}
          </p>
        ) : null}
        <Button
          type='submit'
          disabled={submitting}
          className='mt-2 h-11 w-full rounded-[6px] bg-[#F1F5F7] text-[#080A0D] hover:bg-white'
        >
          {submitting ? '正在创建…' : '创建账户'}
          <ArrowRight />
        </Button>
      </form>
      <p className='mt-7 text-center text-sm text-[#71808B]'>
        已有账户？
        <Link
          to='/login'
          className='ml-1 text-[#D6DDE2] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67C6D9]'
        >
          返回登录
        </Link>
      </p>
    </div>
  )
}
