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
    <PageFrame eyebrow='System / Settings' title='设置' description='个人资料、编辑偏好与当前会话。'>
      <form
        onSubmit={handleSave}
        className='mt-7 max-w-[860px] divide-y divide-[var(--ed-line)] border-y border-[var(--ed-line)]'
      >
        <section className='grid grid-cols-[220px_1fr] gap-10 py-8'>
          <div>
            <p className='font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--ed-blue)]'>01 / Profile</p>
            <h2 className='mt-2 text-[13px] font-semibold text-[var(--ed-ink)]'>个人资料</h2>
            <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>用于工作区内的身份显示。</p>
          </div>
          <div className='max-w-[440px] space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='settings-name' className='text-xs text-[var(--ed-ink-soft)]'>
                显示名称
              </Label>
              <Input
                id='settings-name'
                value={settings.displayName}
                onChange={event => setSettings(current => ({ ...current, displayName: event.target.value }))}
                disabled={loading}
                maxLength={80}
                className='h-9 rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-xs text-[var(--ed-ink)] focus-visible:border-[var(--ed-cyan)] focus-visible:ring-[var(--ed-cyan)]/25'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='settings-email' className='text-xs text-[var(--ed-ink-soft)]'>
                邮箱
              </Label>
              <Input
                id='settings-email'
                type='email'
                value={user?.email ?? ''}
                readOnly
                className='h-9 rounded-[8px] border-[var(--ed-line)] bg-[#0a0f16] text-xs text-[var(--ed-ink-faint)]'
              />
            </div>
          </div>
        </section>

        <section className='grid grid-cols-[220px_1fr] gap-10 py-8'>
          <div>
            <p className='font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--ed-blue)]'>02 / Editor</p>
            <h2 className='mt-2 text-[13px] font-semibold text-[var(--ed-ink)]'>编辑偏好</h2>
            <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>设置编辑项目时的工作习惯。</p>
          </div>
          <div className='max-w-[440px] space-y-5'>
            <div className='flex min-h-12 items-center justify-between gap-5 rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)] px-3.5'>
              <div>
                <Label htmlFor='autosave' className='text-xs text-[var(--ed-ink-soft)]'>
                  自动保存
                </Label>
                <p className='mt-1 text-[10px] text-[var(--ed-ink-faint)]'>编辑停止后保存当前草稿。</p>
              </div>
              <Switch
                id='autosave'
                checked={settings.autosave}
                onCheckedChange={checked => setSettings(current => ({ ...current, autosave: checked }))}
                disabled={loading}
                aria-label='自动保存'
              />
            </div>
            {message ? (
              <output className='block border-l-2 border-[var(--ed-cyan)] px-3 text-xs text-[var(--ed-ink-muted)]'>
                {message}
              </output>
            ) : null}
            <Button
              type='submit'
              disabled={loading || saving}
              className='h-9 rounded-[8px] border border-[#d9e7f2] bg-[#eef7ff] text-xs text-[#07111d] hover:bg-white'
            >
              {saving ? '正在保存…' : '保存设置'}
            </Button>
          </div>
        </section>

        <section className='grid grid-cols-[220px_1fr] gap-10 py-8'>
          <div>
            <p className='font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--ed-blue)]'>03 / Session</p>
            <h2 className='mt-2 text-[13px] font-semibold text-[var(--ed-ink)]'>会话</h2>
            <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>结束当前浏览器中的登录状态。</p>
          </div>
          <div>
            <Button
              type='button'
              variant='outline'
              onClick={() => void handleSignOut()}
              className='h-9 rounded-[8px] border-[#49323a] bg-transparent text-xs text-[#e1bec3] hover:bg-[#28171c] hover:text-white'
            >
              退出登录
            </Button>
          </div>
        </section>
      </form>
    </PageFrame>
  )
}
