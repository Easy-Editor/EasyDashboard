import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  type AgentPreferences,
  DEFAULT_AGENT_PREFERENCES,
  readAgentPreferences,
  updateAgentPreferences,
} from '@/features/agent'
import {
  type AgentModelConfig,
  type AgentModelProvider,
  getUserAgentModelConfig,
  microsToUsdInput,
  probeUserAgentModelConfig,
  updateUserAgentModelConfig,
  usdInputToMicros,
} from '@/features/settings/agent-config-api'
import { type UserSettings, getSettings, updateSettings } from '@/features/settings/settings-api'
import {
  publishWorkspaceRailPreference,
  readCachedWorkspaceRailPreference,
} from '@/features/settings/workspace-rail-preference'
import { PageFrame } from '@/layouts/PageFrame'
import { Check, CircleDashed, X } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

type ProfileSettings = Required<Pick<UserSettings, 'displayName' | 'autosave' | 'workspaceRailPreference'>>

const defaults: ProfileSettings = {
  displayName: '',
  autosave: true,
  workspaceRailPreference: 'collapsed',
}

type AgentModelForm = {
  provider: AgentModelProvider
  endpoint: string
  model: string
  apiKey: string
  fallbackToPlatform: boolean
  taskBudgetUsd: string
  projectBudgetUsd: string
}

const defaultAgentModelForm: AgentModelForm = {
  provider: 'platform',
  endpoint: '',
  model: '',
  apiKey: '',
  fallbackToPlatform: false,
  taskBudgetUsd: '1.00',
  projectBudgetUsd: '20.00',
}

const capabilityLabels = [
  ['vision', '图片理解'],
  ['toolCalling', '工具调用'],
  ['structuredOutput', '结构化输出'],
] as const

const statusLabels = {
  unverified: '待验证',
  probing: '验证中',
  active: '可用',
  failed: '验证失败',
} as const

const settingsSectionClassName =
  'scroll-mt-8 grid grid-cols-[180px_minmax(0,1fr)] gap-8 rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)]/65 p-6'
const settingsSectionIntroClassName = 'self-start'
const settingsControlColumnClassName = 'min-w-0 space-y-5'
const settingsRowClassName =
  'flex min-h-14 items-center justify-between gap-5 border-b border-[var(--ed-line)] py-3 first:pt-0 last:border-b-0 last:pb-0'

function normalizeSettings(settings: UserSettings, ownerUserId?: string | null): ProfileSettings {
  return {
    displayName: settings.displayName ?? defaults.displayName,
    autosave: settings.autosave ?? defaults.autosave,
    workspaceRailPreference: settings.workspaceRailPreference ?? readCachedWorkspaceRailPreference(ownerUserId),
  }
}

export function SettingsPage() {
  const { requestPasswordReset, user, signOut } = useAuth()
  const navigate = useNavigate()
  const [settings, setSettings] = useState(() => normalizeSettings({}, user?.id))
  const [agentPreferences, setAgentPreferences] = useState<AgentPreferences>(DEFAULT_AGENT_PREFERENCES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sendingRecovery, setSendingRecovery] = useState(false)
  const [securityMessage, setSecurityMessage] = useState<string | null>(null)
  const [agentModelForm, setAgentModelForm] = useState<AgentModelForm>(defaultAgentModelForm)
  const [agentModelConfig, setAgentModelConfig] = useState<AgentModelConfig | null>(null)
  const [platformConfigured, setPlatformConfigured] = useState(false)
  const [agentModelLoading, setAgentModelLoading] = useState(true)
  const [agentModelSaving, setAgentModelSaving] = useState(false)
  const [agentModelProbing, setAgentModelProbing] = useState(false)
  const [agentModelMessage, setAgentModelMessage] = useState<string | null>(null)

  const applyAgentModelConfig = useCallback((config: AgentModelConfig | null) => {
    setAgentModelConfig(config)
    setAgentModelForm(
      config
        ? {
            provider: config.provider,
            endpoint: config.endpoint,
            model: config.model,
            apiKey: '',
            fallbackToPlatform: config.fallbackToPlatform,
            taskBudgetUsd: microsToUsdInput(config.budget.taskMicros),
            projectBudgetUsd: microsToUsdInput(config.budget.projectMonthMicros),
          }
        : defaultAgentModelForm,
    )
  }, [])

  const loadAgentModelConfig = useCallback(async () => {
    setAgentModelLoading(true)
    setAgentModelMessage(null)
    try {
      const response = await getUserAgentModelConfig()
      setPlatformConfigured(response.platformConfigured)
      applyAgentModelConfig(response.config)
    } catch {
      setAgentModelMessage('模型配置加载失败，请稍后重试。')
    } finally {
      setAgentModelLoading(false)
    }
  }, [applyAgentModelConfig])

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const value = await getSettings()
      setSettings(normalizeSettings(value, user?.id))
      if (user && value.agentPreferences) {
        setAgentPreferences(updateAgentPreferences(user.id, value.agentPreferences))
      }
    } catch {
      setLoadError('设置加载失败。当前未使用默认值覆盖服务器数据，请重试。')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    void loadAgentModelConfig()
  }, [loadAgentModelConfig])

  useEffect(() => {
    if (!user) return
    setAgentPreferences(readAgentPreferences(user.id))
  }, [user])

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
      const saved = await updateSettings({ ...settings, agentPreferences })
      const normalizedSettings = normalizeSettings(saved, user?.id)
      setSettings(normalizedSettings)
      publishWorkspaceRailPreference(normalizedSettings.workspaceRailPreference, user?.id)
      if (user) {
        setAgentPreferences(updateAgentPreferences(user.id, saved.agentPreferences ?? agentPreferences))
      }
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

  async function handleAgentModelSave() {
    const taskMicros = usdInputToMicros(agentModelForm.taskBudgetUsd)
    const projectMonthMicros = usdInputToMicros(agentModelForm.projectBudgetUsd)
    if (!taskMicros || !projectMonthMicros) {
      setAgentModelMessage('预算必须是大于 0 的美元金额。')
      return
    }
    if (
      agentModelForm.provider === 'openai-compatible' &&
      (!agentModelForm.endpoint.trim() || !agentModelForm.model.trim())
    ) {
      setAgentModelMessage('自定义模型需要填写 Endpoint 和模型名称。')
      return
    }

    setAgentModelSaving(true)
    setAgentModelMessage(null)
    try {
      const apiKey = agentModelForm.apiKey.trim()
      const response = await updateUserAgentModelConfig({
        provider: agentModelForm.provider,
        endpoint: agentModelForm.provider === 'openai-compatible' ? agentModelForm.endpoint.trim() : undefined,
        model: agentModelForm.provider === 'openai-compatible' ? agentModelForm.model.trim() : undefined,
        ...(apiKey ? { apiKey } : {}),
        fallbackToPlatform: agentModelForm.fallbackToPlatform,
        budget: { taskMicros, projectMonthMicros, warningRatio: 0.8 },
      })
      setPlatformConfigured(response.platformConfigured)
      applyAgentModelConfig(response.config)
      setAgentModelMessage(
        agentModelForm.provider === 'platform'
          ? '平台模型配置已保存并启用。能力由平台统一保障。'
          : '配置已保存。验证三项能力后才会启用。',
      )
    } catch {
      setAgentModelMessage('模型配置保存失败，请检查填写内容后重试。')
    } finally {
      setAgentModelSaving(false)
    }
  }

  async function handleAgentModelProbe() {
    setAgentModelProbing(true)
    setAgentModelMessage(null)
    try {
      const response = await probeUserAgentModelConfig()
      setPlatformConfigured(response.platformConfigured)
      applyAgentModelConfig(response.config)
      setAgentModelMessage(response.config?.status === 'active' ? '三项能力验证通过，模型已启用。' : '能力验证未通过。')
    } catch {
      await loadAgentModelConfig()
      setAgentModelMessage('能力验证未通过，请检查 Endpoint、模型名称与 API Key。')
    } finally {
      setAgentModelProbing(false)
    }
  }

  return (
    <PageFrame
      size='standard'
      title='个人设置'
      description='管理你的创作偏好、Agent 与账户。'
      action={
        <Button
          type='submit'
          form='personal-settings-form'
          disabled={loading || saving || Boolean(loadError)}
          className='h-10 rounded-[8px] border border-[var(--ed-action-border)] bg-[var(--ed-action-bg)] px-4 text-xs text-[var(--ed-action-ink)] hover:bg-[var(--ed-action-bg-hover)]'
        >
          {saving ? '正在保存…' : '保存更改'}
        </Button>
      }
    >
      {loadError ? (
        <div
          role='alert'
          className='mt-6 flex max-w-[968px] items-center justify-between gap-5 border border-[color-mix(in_srgb,var(--ed-error)_35%,var(--ed-line))] bg-[color-mix(in_srgb,var(--ed-error)_8%,var(--ed-panel))] px-4 py-3'
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
        id='personal-settings-form'
        onSubmit={handleSave}
        className='mt-8 grid max-w-[968px] grid-cols-[168px_minmax(0,760px)] items-start gap-10'
      >
        <nav aria-label='设置分区' className='sticky top-8 space-y-1'>
          <p className='mb-3 px-3 text-[11px] text-[var(--ed-ink-faint)]'>设置分区</p>
          {[
            ['settings-profile', '个人资料'],
            ['settings-editor', '工作区偏好'],
            ['settings-agent-preferences', 'Agent 偏好'],
            ['settings-agent-model', 'Agent 模型'],
            ['settings-security', '登录安全'],
            ['settings-account', '账户与会话'],
          ].map(([target, label]) => (
            <a
              key={target}
              href={`#${target}`}
              className='block rounded-[6px] px-3 py-2 text-[12px] text-[var(--ed-ink-muted)] outline-none transition-colors hover:bg-[var(--ed-panel)] hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              {label}
            </a>
          ))}
        </nav>

        <div className='space-y-4'>
          {message ? (
            <output className='block rounded-[8px] border border-[var(--ed-line)] border-l-2 border-l-[var(--ed-cyan)] bg-[var(--ed-panel)] px-4 py-3 text-xs text-[var(--ed-ink-muted)]'>
              {message}
            </output>
          ) : null}

          <section id='settings-profile' aria-labelledby='settings-profile-title' className={settingsSectionClassName}>
            <div className={settingsSectionIntroClassName}>
              <h2 id='settings-profile-title' className='text-[14px] font-semibold text-[var(--ed-ink)]'>
                个人资料
              </h2>
              <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>用于工作区内的身份显示。</p>
            </div>
            <div className={settingsControlColumnClassName}>
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

          <section id='settings-editor' aria-labelledby='settings-editor-title' className={settingsSectionClassName}>
            <div className={settingsSectionIntroClassName}>
              <h2 id='settings-editor-title' className='text-[14px] font-semibold text-[var(--ed-ink)]'>
                工作区偏好
              </h2>
              <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>设置导航布局与编辑习惯。</p>
            </div>
            <div className={settingsControlColumnClassName}>
              <div className={settingsRowClassName}>
                <div>
                  <Label htmlFor='workspace-rail-docked' className='text-xs text-[var(--ed-ink-soft)]'>
                    固定侧边栏
                  </Label>
                  <p className='mt-1 text-[11px] text-[var(--ed-ink-faint)]'>
                    开启后为导航保留左侧空间；关闭后默认收起，打开时悬浮显示。
                  </p>
                </div>
                <Switch
                  id='workspace-rail-docked'
                  checked={settings.workspaceRailPreference === 'docked'}
                  onCheckedChange={checked =>
                    setSettings(current => ({
                      ...current,
                      workspaceRailPreference: checked ? 'docked' : 'collapsed',
                    }))
                  }
                  disabled={loading || Boolean(loadError)}
                  aria-label='固定侧边栏'
                />
              </div>
              <div className={settingsRowClassName}>
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
            </div>
          </section>

          <section
            id='settings-agent-preferences'
            aria-labelledby='settings-agent-preferences-title'
            className={settingsSectionClassName}
          >
            <div className={settingsSectionIntroClassName}>
              <h2 id='settings-agent-preferences-title' className='text-[14px] font-semibold text-[var(--ed-ink)]'>
                Agent 偏好
              </h2>
              <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
                个人偏好记忆只属于当前用户，跨项目使用，不会共享给项目成员。
              </p>
            </div>
            <div className={settingsControlColumnClassName}>
              <div className='space-y-2'>
                <Label htmlFor='agent-attachment-scope' className='text-xs text-[var(--ed-ink-soft)]'>
                  新附件默认范围
                </Label>
                <Select
                  value={agentPreferences.defaultAttachmentScope}
                  onValueChange={value =>
                    setAgentPreferences(current => ({
                      ...current,
                      defaultAttachmentScope: value as AgentPreferences['defaultAttachmentScope'],
                    }))
                  }
                >
                  <SelectTrigger
                    id='agent-attachment-scope'
                    className='h-9 w-full rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-xs text-[var(--ed-ink)]'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className='border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] text-[var(--ed-ink)]'>
                    <SelectItem value='conversation'>仅本对话</SelectItem>
                    <SelectItem value='project'>加入项目文件清单</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className={settingsRowClassName}>
                <div>
                  <Label htmlFor='remember-project-context' className='text-xs text-[var(--ed-ink-soft)]'>
                    自动整理项目上下文
                  </Label>
                  <p className='mt-1 text-[11px] text-[var(--ed-ink-faint)]'>
                    先生成待确认内容，确认后在当前项目的 Agent 中使用。
                  </p>
                </div>
                <Switch
                  id='remember-project-context'
                  checked={agentPreferences.rememberProjectContext}
                  onCheckedChange={checked =>
                    setAgentPreferences(current => ({ ...current, rememberProjectContext: checked }))
                  }
                  aria-label='自动整理项目上下文'
                />
              </div>
              <div className={settingsRowClassName}>
                <div>
                  <Label htmlFor='show-task-progress' className='text-xs text-[var(--ed-ink-soft)]'>
                    在对话中显示任务进度
                  </Label>
                  <p className='mt-1 text-[11px] text-[var(--ed-ink-faint)]'>展示业务阶段、等待原因与完成状态。</p>
                </div>
                <Switch
                  id='show-task-progress'
                  checked={agentPreferences.showTaskProgress}
                  onCheckedChange={checked =>
                    setAgentPreferences(current => ({ ...current, showTaskProgress: checked }))
                  }
                  aria-label='在对话中显示任务进度'
                />
              </div>
            </div>
          </section>

          <section
            id='settings-agent-model'
            aria-labelledby='settings-agent-model-title'
            className={settingsSectionClassName}
          >
            <div className={settingsSectionIntroClassName}>
              <h2 id='settings-agent-model-title' className='text-[14px] font-semibold text-[var(--ed-ink)]'>
                Agent 模型
              </h2>
              <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
                选择请求目的地，并限制任务成本。
              </p>
            </div>
            <div className={settingsControlColumnClassName}>
              <div className='space-y-2'>
                <Label htmlFor='agent-model-provider' className='text-xs text-[var(--ed-ink-soft)]'>
                  模型来源
                </Label>
                <Select
                  value={agentModelForm.provider}
                  onValueChange={provider =>
                    setAgentModelForm(current => ({
                      ...current,
                      provider: provider as AgentModelProvider,
                      fallbackToPlatform: provider === 'platform' ? false : current.fallbackToPlatform,
                    }))
                  }
                  disabled={agentModelLoading}
                >
                  <SelectTrigger
                    id='agent-model-provider'
                    className='h-9 w-full rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-xs text-[var(--ed-ink)]'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className='border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] text-[var(--ed-ink)]'>
                    <SelectItem value='platform'>平台模型</SelectItem>
                    <SelectItem value='openai-compatible'>自定义 OpenAI-compatible</SelectItem>
                  </SelectContent>
                </Select>
                {agentModelForm.provider === 'platform' ? (
                  <p className='text-[11px] text-[var(--ed-ink-faint)]'>
                    平台模型：{platformConfigured ? '已配置' : '当前不可用'}
                  </p>
                ) : null}
              </div>

              {agentModelForm.provider === 'openai-compatible' ? (
                <div className='space-y-4 border-l border-[var(--ed-line-strong)] pl-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='agent-model-endpoint' className='text-xs text-[var(--ed-ink-soft)]'>
                      Endpoint
                    </Label>
                    <Input
                      id='agent-model-endpoint'
                      type='url'
                      value={agentModelForm.endpoint}
                      onChange={event => setAgentModelForm(current => ({ ...current, endpoint: event.target.value }))}
                      placeholder='https://api.example.com/v1'
                      disabled={agentModelLoading}
                      className='h-9 rounded-[8px] border-[var(--ed-line-strong)] bg-[#0a0f16] text-xs text-[var(--ed-ink)]'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='agent-model-name' className='text-xs text-[var(--ed-ink-soft)]'>
                      模型名称
                    </Label>
                    <Input
                      id='agent-model-name'
                      value={agentModelForm.model}
                      onChange={event => setAgentModelForm(current => ({ ...current, model: event.target.value }))}
                      placeholder='gpt-4.1-mini'
                      disabled={agentModelLoading}
                      className='h-9 rounded-[8px] border-[var(--ed-line-strong)] bg-[#0a0f16] text-xs text-[var(--ed-ink)]'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='agent-model-api-key' className='text-xs text-[var(--ed-ink-soft)]'>
                      API Key
                    </Label>
                    <Input
                      id='agent-model-api-key'
                      type='password'
                      autoComplete='off'
                      value={agentModelForm.apiKey}
                      onChange={event => setAgentModelForm(current => ({ ...current, apiKey: event.target.value }))}
                      placeholder={agentModelConfig?.configured ? '已安全配置；留空保持不变' : '输入服务端 API Key'}
                      disabled={agentModelLoading}
                      className='h-9 rounded-[8px] border-[var(--ed-line-strong)] bg-[#0a0f16] text-xs text-[var(--ed-ink)]'
                    />
                    <p className='text-[11px] text-[var(--ed-ink-faint)]'>服务器加密保存，读取时不会回显。</p>
                  </div>
                </div>
              ) : null}

              <div className={settingsRowClassName}>
                <div>
                  <Label htmlFor='agent-model-fallback' className='text-xs text-[var(--ed-ink-soft)]'>
                    自定义模型不可用时使用平台模型
                  </Label>
                  <p className='mt-1 text-[11px] text-[var(--ed-ink-faint)]'>
                    必须明确开启；否则不会静默切换并产生平台费用。
                  </p>
                </div>
                <Switch
                  id='agent-model-fallback'
                  checked={agentModelForm.fallbackToPlatform}
                  onCheckedChange={fallbackToPlatform =>
                    setAgentModelForm(current => ({ ...current, fallbackToPlatform }))
                  }
                  disabled={agentModelLoading || agentModelForm.provider === 'platform'}
                  aria-label='自定义模型不可用时使用平台模型'
                />
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-2'>
                  <Label htmlFor='agent-task-budget' className='text-xs text-[var(--ed-ink-soft)]'>
                    单任务预算（USD）
                  </Label>
                  <Input
                    id='agent-task-budget'
                    inputMode='decimal'
                    value={agentModelForm.taskBudgetUsd}
                    onChange={event =>
                      setAgentModelForm(current => ({ ...current, taskBudgetUsd: event.target.value }))
                    }
                    disabled={agentModelLoading}
                    className='h-9 rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-xs text-[var(--ed-ink)]'
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='agent-project-budget' className='text-xs text-[var(--ed-ink-soft)]'>
                    项目月预算（USD）
                  </Label>
                  <Input
                    id='agent-project-budget'
                    inputMode='decimal'
                    value={agentModelForm.projectBudgetUsd}
                    onChange={event =>
                      setAgentModelForm(current => ({ ...current, projectBudgetUsd: event.target.value }))
                    }
                    disabled={agentModelLoading}
                    className='h-9 rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-xs text-[var(--ed-ink)]'
                  />
                </div>
              </div>
              <p className='text-[11px] text-[var(--ed-ink-faint)]'>达到任一预算的 80% 时发出预警。</p>

              <div className='border-y border-[var(--ed-line)] py-3.5'>
                <div className='flex items-center justify-between gap-4'>
                  <p className='text-xs font-medium text-[var(--ed-ink-soft)]'>能力验证</p>
                  <span className='font-mono text-[10px] text-[var(--ed-ink-faint)]'>
                    {agentModelConfig ? statusLabels[agentModelConfig.status] : '未配置'}
                  </span>
                </div>
                <div className='mt-3 grid grid-cols-3 gap-2'>
                  {capabilityLabels.map(([capability, label]) => {
                    const result = agentModelConfig?.capabilities?.[capability]
                    const Icon = result === true ? Check : result === false ? X : CircleDashed
                    return (
                      <div
                        key={capability}
                        className='flex items-center gap-1.5 text-[11px] text-[var(--ed-ink-muted)]'
                      >
                        <Icon
                          className={
                            result === true
                              ? 'size-3.5 text-[var(--ed-success)]'
                              : 'size-3.5 text-[var(--ed-ink-faint)]'
                          }
                          aria-hidden='true'
                        />
                        {label}
                      </div>
                    )
                  })}
                </div>
              </div>

              {agentModelMessage ? (
                <output className='block border-l-2 border-[var(--ed-cyan)] px-3 text-xs text-[var(--ed-ink-muted)]'>
                  {agentModelMessage}
                </output>
              ) : null}
              <div className='flex gap-2'>
                <Button
                  type='button'
                  onClick={() => void handleAgentModelSave()}
                  disabled={agentModelLoading || agentModelSaving || agentModelProbing}
                  className='h-9 rounded-[8px] border border-[var(--ed-action-border)] bg-[var(--ed-action-bg)] text-xs text-[var(--ed-action-ink)] hover:bg-[var(--ed-action-bg-hover)]'
                >
                  {agentModelSaving ? '正在保存…' : '保存模型配置'}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => void handleAgentModelProbe()}
                  disabled={
                    agentModelForm.provider === 'platform' ||
                    agentModelLoading ||
                    agentModelSaving ||
                    agentModelProbing ||
                    !agentModelConfig?.configured
                  }
                  className='h-9 rounded-[8px] border-[var(--ed-line-strong)] bg-transparent text-xs text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-white'
                >
                  {agentModelForm.provider === 'platform'
                    ? '平台能力已配置'
                    : agentModelProbing
                      ? '正在验证…'
                      : '验证三项能力'}
                </Button>
              </div>
            </div>
          </section>

          <section
            id='settings-security'
            aria-labelledby='settings-security-title'
            className={settingsSectionClassName}
          >
            <div className={settingsSectionIntroClassName}>
              <h2 id='settings-security-title' className='text-[14px] font-semibold text-[var(--ed-ink)]'>
                登录安全
              </h2>
              <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>通过当前登录邮箱更新账户密码。</p>
            </div>
            <div className={settingsControlColumnClassName}>
              <div className={settingsRowClassName}>
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

          <section id='settings-account' aria-labelledby='settings-account-title' className={settingsSectionClassName}>
            <div className={settingsSectionIntroClassName}>
              <h2 id='settings-account-title' className='text-[14px] font-semibold text-[var(--ed-ink)]'>
                账户与会话
              </h2>
              <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
                当前为个人空间；退出只结束此浏览器会话。
              </p>
            </div>
            <div className={settingsControlColumnClassName}>
              <dl className='grid grid-cols-2 border-y border-[var(--ed-line)]'>
                <div className='border-r border-[var(--ed-line)] py-3 pr-4'>
                  <dt className='text-[11px] text-[var(--ed-ink-faint)]'>空间</dt>
                  <dd className='mt-1.5 text-[12px] text-[var(--ed-ink-soft)]'>个人空间</dd>
                </div>
                <div className='py-3 pl-4'>
                  <dt className='text-[11px] text-[var(--ed-ink-faint)]'>状态</dt>
                  <dd className='mt-1.5 flex items-center gap-2 text-[12px] text-[var(--ed-ink-soft)]'>
                    <span className='size-1.5 rounded-full bg-[var(--ed-success)]' aria-hidden='true' />
                    已登录
                  </dd>
                </div>
              </dl>
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
        </div>
      </form>
    </PageFrame>
  )
}
