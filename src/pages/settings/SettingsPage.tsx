import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { type UserSettings, getSettings, updateSettings } from '@/features/settings/settings-api'
import { PageFrame } from '@/layouts/PageFrame'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
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
  const { requestPasswordReset, user, signOut } = useAuth()
  const navigate = useNavigate()
  const [settings, setSettings] = useState(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sendingRecovery, setSendingRecovery] = useState(false)
  const [securityMessage, setSecurityMessage] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const value = await getSettings()
      setSettings(normalizeSettings(value))
    } catch {
      setLoadError('设置加载失败。当前未使用默认值覆盖服务器数据，请重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  async function handleRecoveryEmail() {
    if (!user?.email) return
    setSendingRecovery(true)
    setSecurityMessage(null)
    try {
      await requestPasswordReset(user.email)
      setSecurityMessage('密码重置邮件已发送，请在邮件中继续。')
    } catch {
      setSecurityMessage('密码重置邮件发送失败，请稍后重试。')
    } finally {
      setSendingRecovery(false)
    }
  }

  /*
   * Settings are intentionally loaded independently from the authenticated
   * account. A settings failure must stay visible instead of masquerading as
   * successfully loaded defaults.
   */
  useEffect(() => {
    if (!loadError) return
    setMessage(null)
  }, [loadError])

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
    <PageFrame eyebrow='System / Settings' title='设置' description='管理个人资料、编辑偏好、登录安全与当前账户状态。'>
      {loadError ? (
        <div
          role='alert'
          className='mt-6 flex max-w-[860px] items-center justify-between gap-5 border border-[color-mix(in_srgb,var(--ed-error)_35%,var(--ed-line))] bg-[color-mix(in_srgb,var(--ed-error)_8%,var(--ed-panel))] px-4 py-3'
        >
          <p className='text-[12px] text-[var(--ed-error)]'>{loadError}</p>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => void loadSettings()}
            className='h-8 border-[var(--ed-line-strong)] bg-transparent text-[11px] text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)]'
          >
            重新加载
          </Button>
        </div>
      ) : null}
      <form
        onSubmit={handleSave}
        className='mt-7 max-w-[860px] divide-y divide-[var(--ed-line)] border-y border-[var(--ed-line)]'
      >
        <section className='grid grid-cols-[220px_1fr] gap-10 py-8'>
          <div>
            <p className='font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--ed-cyan)]'>01 / Profile</p>
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
                disabled={loading || Boolean(loadError)}
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
            <p className='font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--ed-cyan)]'>02 / Editor</p>
            <h2 className='mt-2 text-[13px] font-semibold text-[var(--ed-ink)]'>编辑偏好</h2>
            <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>设置编辑项目时的工作习惯。</p>
          </div>
          <div className='max-w-[440px] space-y-5'>
            <div className='flex min-h-12 items-center justify-between gap-5 rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)] px-3.5'>
              <div>
                <Label htmlFor='autosave' className='text-xs text-[var(--ed-ink-soft)]'>
                  自动保存
                </Label>
                <p className='mt-1 text-[11px] text-[var(--ed-ink-faint)]'>编辑停止后保存当前草稿。</p>
              </div>
              <Switch
                id='autosave'
                checked={settings.autosave}
                onCheckedChange={checked => setSettings(current => ({ ...current, autosave: checked }))}
                disabled={loading || Boolean(loadError)}
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
              disabled={loading || saving || Boolean(loadError)}
              className='h-9 rounded-[8px] border border-[#d9e7f2] bg-[#eef7ff] text-xs text-[#07111d] hover:bg-white'
            >
              {saving ? '正在保存…' : '保存设置'}
            </Button>
          </div>
        </section>

        <section className='grid grid-cols-[220px_1fr] gap-10 py-8'>
          <div>
            <p className='font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--ed-cyan)]'>03 / Security</p>
            <h2 className='mt-2 text-[13px] font-semibold text-[var(--ed-ink)]'>登录安全</h2>
            <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>通过当前登录邮箱更新账户密码。</p>
          </div>
          <div className='max-w-[440px] space-y-4'>
            <div className='flex items-center justify-between gap-5 rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)] px-3.5 py-3'>
              <div className='min-w-0'>
                <p className='text-[12px] font-medium text-[var(--ed-ink-soft)]'>密码</p>
                <p className='mt-1 truncate text-[11px] text-[var(--ed-ink-faint)]'>
                  重置链接将发送到 {user?.email ?? '当前账户邮箱'}
                </p>
              </div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={sendingRecovery || !user?.email}
                onClick={() => void handleRecoveryEmail()}
                className='h-8 shrink-0 border-[var(--ed-line-strong)] bg-transparent text-[11px] text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-white'
              >
                {sendingRecovery ? '正在发送…' : '发送重置邮件'}
              </Button>
            </div>
            {securityMessage ? (
              <output className='block border-l-2 border-[var(--ed-cyan)] px-3 text-[12px] text-[var(--ed-ink-muted)]'>
                {securityMessage}
              </output>
            ) : null}
          </div>
        </section>

        <section className='grid grid-cols-[220px_1fr] gap-10 py-8'>
          <div>
            <p className='font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--ed-cyan)]'>04 / Account</p>
            <h2 className='mt-2 text-[13px] font-semibold text-[var(--ed-ink)]'>账户与会话</h2>
            <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
              当前为个人空间；退出只结束此浏览器会话。
            </p>
          </div>
          <div className='max-w-[440px] space-y-4'>
            <div className='grid grid-cols-2 border border-[var(--ed-line)] bg-[var(--ed-panel)]'>
              <div className='border-r border-[var(--ed-line)] px-3.5 py-3'>
                <p className='font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ed-ink-faint)]'>空间</p>
                <p className='mt-1.5 text-[12px] text-[var(--ed-ink-soft)]'>个人空间</p>
              </div>
              <div className='px-3.5 py-3'>
                <p className='font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ed-ink-faint)]'>状态</p>
                <p className='mt-1.5 flex items-center gap-2 text-[12px] text-[var(--ed-ink-soft)]'>
                  <span className='size-1.5 rounded-full bg-[var(--ed-success)]' aria-hidden='true' />
                  已登录
                </p>
              </div>
            </div>
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
