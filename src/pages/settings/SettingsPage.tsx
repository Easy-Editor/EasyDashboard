import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { type UserSettings, getSettings, updateSettings } from '@/features/settings/settings-api'
import { PageFrame } from '@/layouts/PageFrame'
import { type FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

const defaults: Required<UserSettings> = {
  displayName: '',
  autosave: true,
}

function normalizeSettings(settings: UserSettings): Required<UserSettings> {
  return {
    displayName: settings.displayName ?? defaults.displayName,
    autosave: settings.autosave ?? defaults.autosave,
  }
}

export function SettingsPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [settings, setSettings] = useState(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void getSettings()
      .then(value => setSettings(normalizeSettings(value)))
      .catch(() => setMessage('设置加载失败，当前显示默认值'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const saved = await updateSettings(settings)
      setSettings(normalizeSettings(saved))
      setMessage('设置已保存')
    } catch {
      setMessage('设置保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <PageFrame eyebrow='System / Settings' title='设置' description='管理个人资料和编辑偏好。'>
      <form onSubmit={handleSave} className='mt-10 max-w-3xl divide-y divide-[#222B34] border-y border-[#222B34]'>
        <section className='grid gap-6 py-7 md:grid-cols-[190px_1fr]'>
          <div>
            <h2 className='text-sm font-medium text-[#F1F5F7]'>个人资料</h2>
            <p className='mt-1 text-xs leading-5 text-[#71808B]'>显示名称保存在你的工作区设置中。</p>
          </div>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='settings-name' className='text-[#C7D0D6]'>
                名称
              </Label>
              <Input
                id='settings-name'
                value={settings.displayName}
                onChange={event => setSettings(current => ({ ...current, displayName: event.target.value }))}
                disabled={loading}
                maxLength={80}
                className='h-9 rounded-[6px] border-[#2A333D] bg-[#0F1318] text-[#F1F5F7] focus-visible:border-[#67C6D9] focus-visible:ring-[#67C6D9]/30'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='settings-email' className='text-[#C7D0D6]'>
                邮箱
              </Label>
              <Input
                id='settings-email'
                type='email'
                value={user?.email ?? ''}
                readOnly
                className='h-9 rounded-[6px] border-[#2A333D] bg-[#0F1318] text-[#87939D]'
              />
            </div>
          </div>
        </section>

        <section className='grid gap-6 py-7 md:grid-cols-[190px_1fr]'>
          <div>
            <h2 className='text-sm font-medium text-[#F1F5F7]'>编辑偏好</h2>
            <p className='mt-1 text-xs leading-5 text-[#71808B]'>设置编辑项目时的工作习惯。</p>
          </div>
          <div className='space-y-4'>
            <div className='flex min-h-11 items-center justify-between gap-5'>
              <div>
                <Label htmlFor='autosave' className='text-[#C7D0D6]'>
                  自动保存
                </Label>
                <p className='mt-1 text-xs text-[#71808B]'>编辑停止后保存当前草稿。</p>
              </div>
              <Switch
                id='autosave'
                checked={settings.autosave}
                onCheckedChange={checked => setSettings(current => ({ ...current, autosave: checked }))}
                disabled={loading}
                aria-label='自动保存'
              />
            </div>
            {message ? <output className='block text-sm text-[#8FA0AA]'>{message}</output> : null}
            <Button type='submit' disabled={loading || saving} className='rounded-[6px] bg-[#F1F5F7] text-[#080A0D]'>
              {saving ? '正在保存…' : '保存设置'}
            </Button>
          </div>
        </section>

        <section className='grid gap-6 py-7 md:grid-cols-[190px_1fr]'>
          <div>
            <h2 className='text-sm font-medium text-[#F1F5F7]'>会话</h2>
            <p className='mt-1 text-xs leading-5 text-[#71808B]'>结束当前浏览器中的登录状态。</p>
          </div>
          <div>
            <Button
              type='button'
              variant='outline'
              onClick={() => void handleSignOut()}
              className='rounded-[6px] border-[#3A3333] bg-transparent text-[#D6DDE2] hover:bg-[#211719] hover:text-white'
            >
              退出登录
            </Button>
          </div>
        </section>
      </form>
    </PageFrame>
  )
}
