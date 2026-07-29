import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowRight } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      const requestedPath = (location.state as { from?: string } | null)?.from
      navigate(requestedPath?.startsWith('/') ? requestedPath : '/projects', { replace: true })
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 401 ? '邮箱或密码不正确' : '登录失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <p className='font-mono text-[10px] uppercase tracking-[0.16em] text-[#67C6D9]'>Sign in</p>
      <h1 className='mt-3 font-[Alibaba_PuHuiTi] text-[28px] font-medium tracking-[-0.02em]'>登录工作台</h1>
      <p className='mt-2 text-sm leading-6 text-[#7F8B95]'>继续管理项目、预览结果和发布状态。</p>
      <form className='mt-9 space-y-5' onSubmit={handleSubmit}>
        <div className='space-y-2'>
          <Label htmlFor='login-email' className='text-[#D6DDE2]'>
            邮箱
          </Label>
          <Input
            id='login-email'
            name='email'
            type='email'
            autoComplete='email'
            required
            placeholder='name@example.com'
            className='h-11 rounded-[6px] border-[#2A333D] bg-[#0F1318] text-[#F1F5F7] placeholder:text-[#596671] focus-visible:border-[#67C6D9] focus-visible:ring-[#67C6D9]/30'
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='login-password' className='text-[#D6DDE2]'>
            密码
          </Label>
          <Input
            id='login-password'
            name='password'
            type='password'
            autoComplete='current-password'
            required
            minLength={8}
            placeholder='输入密码'
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
          className='h-11 w-full rounded-[6px] bg-[#F1F5F7] text-[#080A0D] hover:bg-white'
        >
          {submitting ? '正在登录…' : '登录'}
          <ArrowRight />
        </Button>
      </form>
      <p className='mt-7 text-center text-sm text-[#71808B]'>
        还没有账户？
        <Link
          to='/signup'
          className='ml-1 text-[#D6DDE2] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67C6D9]'
        >
          创建账户
        </Link>
      </p>
    </div>
  )
}
