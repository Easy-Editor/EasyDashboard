import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/useAuth'
import { type ProjectCardProject, formatProjectTime } from '@/components/project/ProjectCard'
import { ProjectThumbnail } from '@/components/project/ProjectThumbnail'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { defaultProjectSchema } from '@/editor/const'
import {
  AGENT_ATTACHMENT_ACCEPT,
  AGENT_ATTACHMENT_FORMAT_LABEL,
  type AgentAttachmentInput,
  connectAgentWorkspaceSync,
  finalizeAgentStartAttachments,
  hasAgentWorkspaceRecovery,
  hydrateAgentProjectWorkspace,
  isSupportedAgentAttachment,
  readAgentWorkspace,
  recordAgentRun,
  replaceAgentWorkspace,
  setAgentMessageAttachments,
  startAgentProject,
  syncAgentWorkspaceProject,
  updateAgentPreferences,
  updateTaskProgress,
  uploadAgentFile,
} from '@/features/agent'
import { listProjects } from '@/features/projects/project-api'
import { getSettings } from '@/features/settings/settings-api'
import { ArrowRight, File, Image, LoaderCircle, MessageSquareText, Paperclip, X } from 'lucide-react'
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'

type PendingAttachment = {
  id: string
  name: string
  size: number
  type: string
  scope: 'conversation' | 'project'
  file: File
}

type PendingAgentStart = Awaited<ReturnType<typeof startAgentProject>>

type AgentStartAttachmentFlowDependencies = {
  uploadAgentFile: typeof uploadAgentFile
  setAgentMessageAttachments: typeof setAgentMessageAttachments
  updateTaskProgress: typeof updateTaskProgress
  syncAgentWorkspaceProject: typeof syncAgentWorkspaceProject
  finalizeAgentStartAttachments: typeof finalizeAgentStartAttachments
  recordAgentRun: typeof recordAgentRun
}

const agentStartAttachmentFlowDependencies: AgentStartAttachmentFlowDependencies = {
  uploadAgentFile,
  setAgentMessageAttachments,
  updateTaskProgress,
  syncAgentWorkspaceProject,
  finalizeAgentStartAttachments,
  recordAgentRun,
}

export function getLegacyAgentStartOperationId(started: { run?: { operationId?: string } }): string | null {
  return started.run?.operationId?.trim() || null
}

export async function runAgentStartAttachmentFlow(
  input: {
    ownerUserId: string
    started: PendingAgentStart
    attachments: PendingAttachment[]
    uploadedAttachments: Map<string, AgentAttachmentInput>
  },
  dependencies: AgentStartAttachmentFlowDependencies = agentStartAttachmentFlowDependencies,
): Promise<string> {
  const uploaded: AgentAttachmentInput[] = []
  for (const attachment of input.attachments) {
    let completed = input.uploadedAttachments.get(attachment.id)
    if (!completed) {
      completed = await dependencies.uploadAgentFile(input.started.project.id, input.started.conversation.id, {
        file: attachment.file,
        scope: attachment.scope,
        idempotencyKey: attachment.id,
      })
      input.uploadedAttachments.set(attachment.id, completed)
    }
    uploaded.push(completed)
  }
  const firstMessage = input.started.conversation.messages[0]
  const firstTask = input.started.conversation.tasks[0]
  if (!firstMessage || !firstTask) throw new Error('原子启动未返回首条任务')
  dependencies.setAgentMessageAttachments({
    ownerUserId: input.ownerUserId,
    conversationId: input.started.conversation.id,
    messageId: firstMessage.id,
    attachments: uploaded,
  })
  const legacyOperationId = getLegacyAgentStartOperationId(input.started)
  if (legacyOperationId) {
    dependencies.updateTaskProgress({
      ownerUserId: input.ownerUserId,
      conversationId: input.started.conversation.id,
      taskId: firstTask.id,
      taskStatus: 'waiting',
      stageId: 'plan-layout',
      stageStatus: 'waiting',
      detail: '等待 Agent 执行服务',
    })
  }
  const attachmentSync = await dependencies.syncAgentWorkspaceProject({
    ownerUserId: input.ownerUserId,
    projectId: input.started.project.id,
  })
  if (attachmentSync.status === 'local-offline') {
    throw new Error('附件已经上传，但工作区尚未同步到服务端')
  }
  if (legacyOperationId) {
    const resumedRun = await dependencies.finalizeAgentStartAttachments(input.started.project.id, legacyOperationId)
    dependencies.recordAgentRun({
      ownerUserId: input.ownerUserId,
      conversationId: input.started.conversation.id,
      taskId: firstTask.id,
      operationId: resumedRun.operationId,
      status: resumedRun.status,
      outcome: resumedRun.outcome,
      receipt: resumedRun.receipt,
      cost: resumedRun.cost,
      trace: resumedRun.trace,
      rollback: resumedRun.rollback,
      rolledBackAt: resumedRun.rolledBackAt,
      rollbackReceipt: resumedRun.rollbackReceipt,
      usage: resumedRun.usage,
    })
    await dependencies.syncAgentWorkspaceProject({
      ownerUserId: input.ownerUserId,
      projectId: input.started.project.id,
    })
  }
  return `/projects/${input.started.project.id}/agent/${input.started.conversation.id}`
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

export function selectRecentDesigns(projects: ProjectCardProject[], limit = 4): ProjectCardProject[] {
  return [...projects].sort((first, second) => timestamp(second.savedAt) - timestamp(first.savedAt)).slice(0, limit)
}

export function selectRecentPublications(projects: ProjectCardProject[], limit = 4): ProjectCardProject[] {
  return [...projects]
    .filter(project => project.state === 'published')
    .sort((first, second) => timestamp(second.publishedAt) - timestamp(first.publishedAt))
    .slice(0, limit)
}

export function formatPublishedProjectActivity(project: ProjectCardProject): string {
  const releaseLabel = project.currentReleaseNumber === null ? '发布版本待同步' : `版本 ${project.currentReleaseNumber}`
  const timeLabel = project.publishedAt ? `发布于 ${formatProjectTime(project.publishedAt)}` : '发布时间待同步'
  return `${releaseLabel} · ${timeLabel}`
}

export function deriveAgentProjectName(prompt: string): string {
  const firstLine = prompt
    .trim()
    .split(/\r?\n/u)[0]
    ?.replace(/[，。！？,.!?；;：:]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!firstLine) return '未命名大屏'
  const compact = firstLine.replace(/^(?:请|帮我)?\s*(?:创建|搭建|做一个|做一块|制作)?\s*/u, '')
  return compact.slice(0, 28) || '未命名大屏'
}

export function resolveRecentProjectTarget(
  projectId: string,
  conversations: ReadonlyArray<{ id: string; projectId: string; updatedAt: string }>,
): string {
  const latestConversation = conversations
    .filter(conversation => conversation.projectId === projectId)
    .sort((first, second) => timestamp(second.updatedAt) - timestamp(first.updatedAt))[0]

  return latestConversation ? `/projects/${projectId}/agent/${latestConversation.id}` : `/projects/${projectId}/agent`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [projects, setProjects] = useState<ProjectCardProject[]>([])
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachmentScope, setAttachmentScope] = useState<'conversation' | 'project'>('conversation')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [startIdempotencyKey, setStartIdempotencyKey] = useState<string | null>(null)
  const [pendingStart, setPendingStart] = useState<PendingAgentStart | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [agentWorkspaceVersion, setAgentWorkspaceVersion] = useState(0)
  const [agentSyncOffline, setAgentSyncOffline] = useState(false)
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null)
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null)
  const [agentRecoveryWarning, setAgentRecoveryWarning] = useState(false)
  const startIdempotencyKeyRef = useRef<string | null>(null)
  const uploadedAttachmentsRef = useRef(new Map<string, AgentAttachmentInput>())

  const loadProjects = useCallback(async () => {
    setLoading(true)
    setProjectLoadError(null)
    try {
      const response = await listProjects()
      setProjects(response.projects)
    } catch (reason) {
      setProjectLoadError(reason instanceof ApiError ? reason.message : '工作区项目加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setSettingsLoadError(null)
    try {
      const settings = await getSettings()
      if (user && settings.agentPreferences) {
        const preferences = updateAgentPreferences(user.id, settings.agentPreferences)
        setAttachmentScope(preferences.defaultAttachmentScope)
      }
    } catch {
      setSettingsLoadError('个人设置读取失败，当前使用默认配置。')
    }
  }, [user])

  useEffect(() => {
    void loadProjects()
    void loadSettings()
  }, [loadProjects, loadSettings])

  useEffect(() => {
    if (!user) return
    setAttachmentScope(readAgentWorkspace(user.id).preferences.defaultAttachmentScope)
    setAgentRecoveryWarning(hasAgentWorkspaceRecovery(user.id))
  }, [user])

  useEffect(() => {
    if (!user) return
    const disconnect = projects.map(project =>
      connectAgentWorkspaceSync({
        ownerUserId: user.id,
        projectId: project.id,
        onWorkspace: () => setAgentWorkspaceVersion(version => version + 1),
        onStatus: status => {
          if (status === 'offline' || status === 'error') setAgentSyncOffline(true)
        },
      }),
    )
    return () => disconnect.forEach(stop => stop())
  }, [projects, user])

  const recentDesigns = useMemo(() => selectRecentDesigns(projects), [projects])
  const recentConversations = useMemo(() => {
    void agentWorkspaceVersion
    if (!user) return []
    return [...readAgentWorkspace(user.id).conversations].sort(
      (first, second) => timestamp(second.updatedAt) - timestamp(first.updatedAt),
    )
  }, [agentWorkspaceVersion, user])
  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    if (pendingStart) return
    const selected = Array.from(event.currentTarget.files ?? [])
    const next = selected.filter(isSupportedAgentAttachment).map(file => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      scope: attachmentScope,
      file,
    }))
    setAttachments(current => [...current, ...next].slice(0, 8))
    if (next.length < selected.length) toast.error(`仅支持 ${AGENT_ATTACHMENT_FORMAT_LABEL}`)
    event.currentTarget.value = ''
  }

  function openAttachmentPicker() {
    if (pendingStart !== null || startIdempotencyKey !== null) return
    fileInputRef.current?.click()
  }

  async function startAgentTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt || !user) return

    setCreating(true)
    setStartError(null)
    let started = pendingStart
    try {
      if (!started) {
        uploadedAttachmentsRef.current.clear()
        const idempotencyKey = startIdempotencyKeyRef.current ?? crypto.randomUUID()
        startIdempotencyKeyRef.current = idempotencyKey
        setStartIdempotencyKey(idempotencyKey)
        started = await startAgentProject({
          idempotencyKey,
          project: {
            name: deriveAgentProjectName(normalizedPrompt),
            description: normalizedPrompt.slice(0, 240),
            schema: structuredClone(defaultProjectSchema),
          },
          prompt: normalizedPrompt,
          attachments: attachments.map(attachment => ({
            name: attachment.name,
            scope: attachment.scope,
            mimeType: attachment.type,
            size: attachment.size,
          })),
        })
        setPendingStart(started)
        replaceAgentWorkspace(hydrateAgentProjectWorkspace(readAgentWorkspace(user.id), started.workspace.payload))
      }

      let destination = `/projects/${started.project.id}/agent/${started.conversation.id}`
      if (attachments.length > 0) {
        destination = await runAgentStartAttachmentFlow({
          ownerUserId: user.id,
          started,
          attachments,
          uploadedAttachments: uploadedAttachmentsRef.current,
        })
      }
      setPendingStart(null)
      startIdempotencyKeyRef.current = null
      setStartIdempotencyKey(null)
      setAttachments([])
      uploadedAttachmentsRef.current.clear()
      navigate(destination)
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Agent 项目创建失败，请重试'
      if (started) {
        setPendingStart(started)
        setStartError(`项目与任务已安全保留，但附件尚未全部就绪：${detail}。请在此重试，不会重复创建项目。`)
      } else {
        const canSafelyChangeRequest = reason instanceof ApiError && reason.status < 500 && reason.status !== 409
        if (canSafelyChangeRequest) {
          startIdempotencyKeyRef.current = null
          setStartIdempotencyKey(null)
          setStartError(detail)
        } else {
          setStartError(`启动结果尚未确认：${detail}。请保持当前内容并重试，已创建的项目会被安全复用。`)
        }
      }
      toast.error(detail)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className='ed-home-page relative isolate mx-auto min-h-screen w-full max-w-[980px] px-10 pb-16 pt-[clamp(96px,16vh,144px)]'>
      {settingsLoadError || agentRecoveryWarning || agentSyncOffline ? (
        <div className='mx-auto mb-5 max-w-[820px] space-y-2'>
          {settingsLoadError ? (
            <div className='flex items-center justify-between gap-4 rounded-[8px] bg-[#332814]/45 px-4 py-2.5 shadow-[inset_0_0_0_1px_rgba(217,164,65,.28)]'>
              <output className='text-xs text-[#e8c477]'>{settingsLoadError}</output>
              <Button
                type='button'
                variant='ghost'
                onClick={() => void loadSettings()}
                className='h-7 rounded-[6px] px-2.5 text-[11px] text-[#e8c477] hover:bg-[#4a3819]/55 hover:text-[#ffe0a0]'
              >
                重试
              </Button>
            </div>
          ) : null}
          {agentRecoveryWarning ? (
            <div
              role='alert'
              className='rounded-[8px] bg-[color-mix(in_srgb,var(--ed-warning)_8%,var(--ed-panel))] px-4 py-2.5 text-xs text-[var(--ed-ink-muted)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ed-warning)_24%,transparent)]'
            >
              检测到无法读取的旧 Agent 本地数据，原始副本已隔离保留；当前从空白 Agent 状态继续。
            </div>
          ) : null}
          {agentSyncOffline ? (
            <output className='block rounded-[8px] bg-[var(--ed-panel)] px-4 py-2.5 text-xs text-[var(--ed-ink-muted)] shadow-[inset_0_0_0_1px_var(--ed-line)]'>
              Agent 工作区当前离线，最近对话来自本机缓存。
            </output>
          ) : null}
        </div>
      ) : null}

      <section
        data-home-launcher='primary'
        aria-labelledby='home-agent-title'
        className='ed-home-primary mx-auto w-full max-w-[820px]'
      >
        <div className='text-center'>
          <h1
            id='home-agent-title'
            className='font-[var(--font-display)] text-[32px] leading-[1.2] font-normal tracking-[-0.03em] text-[var(--ed-ink)]'
          >
            从这里开始你的下一块大屏
          </h1>
          <p id='home-goal-help' className='mt-3 text-[13px] leading-6 text-[var(--ed-ink-muted)]'>
            描述你的想法，Agent 会和你一起把它做出来。
          </p>
        </div>

        {startError ? (
          <p role='alert' className='mt-5 rounded-[8px] bg-[#332814]/45 px-4 py-2.5 text-xs leading-5 text-[#e8c477]'>
            {startError}
          </p>
        ) : null}

        <form className='mt-8' onSubmit={startAgentTask}>
          <div className='ed-home-composer overflow-hidden rounded-[12px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] shadow-[0_18px_48px_rgba(0,0,0,.2),inset_0_1px_rgba(202,225,238,.03)] focus-within:border-[var(--ed-cyan)]/65 focus-within:shadow-[0_22px_54px_rgba(0,0,0,.24),0_0_0_2px_rgba(109,220,243,.07)]'>
            <div className='flex items-center justify-between gap-4 px-4 pt-3.5'>
              <label htmlFor='home-project-goal' className='text-[11px] font-medium text-[var(--ed-ink-muted)]'>
                告诉 Agent 你的需求
              </label>
              <span className='font-mono text-[10px] text-[var(--ed-ink-faint)]'>{prompt.length} / 4000</span>
            </div>
            <Textarea
              id='home-project-goal'
              aria-describedby='home-goal-help'
              value={prompt}
              onChange={event => setPrompt(event.currentTarget.value)}
              disabled={pendingStart !== null || startIdempotencyKey !== null}
              rows={3}
              maxLength={4000}
              placeholder='例如：城市低空运行态势大屏，优先展示实时航班、告警分布和最近 24 小时趋势。'
              className='min-h-[96px] resize-none border-0 bg-transparent px-4 py-3 text-[14px] leading-6 text-[var(--ed-ink)] shadow-none outline-none placeholder:text-[#687a8d] focus-visible:ring-0'
            />

            {attachments.length > 0 ? (
              <div className='flex flex-wrap gap-2 border-t border-[var(--ed-line)] px-3 py-2.5'>
                {attachments.map(attachment => (
                  <span
                    key={attachment.id}
                    className='inline-flex h-8 items-center gap-2 rounded-[6px] bg-[var(--ed-panel)] px-2.5 text-[11px] text-[var(--ed-ink-soft)] shadow-[inset_0_0_0_1px_var(--ed-line-strong)]'
                  >
                    {attachment.type.startsWith('image/') ? (
                      <Image className='size-3.5 text-[var(--ed-cyan)]' />
                    ) : (
                      <File className='size-3.5 text-[var(--ed-blue)]' />
                    )}
                    <span className='max-w-36 truncate'>{attachment.name}</span>
                    <span className='font-mono text-[11px] text-[var(--ed-ink-faint)]'>
                      {formatFileSize(attachment.size)}
                    </span>
                    <button
                      type='button'
                      className='rounded text-[var(--ed-ink-faint)] outline-none hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
                      aria-label={`移除 ${attachment.name}`}
                      onClick={() => setAttachments(current => current.filter(item => item.id !== attachment.id))}
                      disabled={pendingStart !== null || startIdempotencyKey !== null}
                    >
                      <X className='size-3' />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <input
              ref={fileInputRef}
              type='file'
              multiple
              disabled={pendingStart !== null || startIdempotencyKey !== null}
              tabIndex={-1}
              className='hidden'
              accept={AGENT_ATTACHMENT_ACCEPT}
              onChange={selectFiles}
            />
            <div className='flex items-center gap-1.5 border-t border-[var(--ed-line)] px-3 py-2.5'>
              <button
                type='button'
                disabled={pendingStart !== null || startIdempotencyKey !== null}
                onClick={openAttachmentPicker}
                className='flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] text-[var(--ed-ink-muted)] outline-none transition-colors hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)] disabled:cursor-not-allowed disabled:opacity-45'
              >
                <Paperclip className='size-3.5' />
                添加附件
              </button>
              <Button
                type='submit'
                disabled={creating || !prompt.trim() || !user}
                size='icon'
                aria-label={
                  creating
                    ? '正在创建项目'
                    : pendingStart
                      ? '继续上传并进入对话'
                      : startIdempotencyKey
                        ? '检查创建结果'
                        : '创建并进入对话'
                }
                title={
                  creating
                    ? '正在创建项目'
                    : pendingStart
                      ? '继续上传并进入对话'
                      : startIdempotencyKey
                        ? '检查创建结果'
                        : '创建并进入对话'
                }
                className='ml-auto size-9 rounded-[8px] border border-[var(--ed-action-border)] bg-[var(--ed-action-bg)] text-[var(--ed-action-ink)] hover:bg-[var(--ed-action-bg-hover)]'
              >
                {creating ? <LoaderCircle className='size-3.5 animate-spin' /> : <ArrowRight className='size-3.5' />}
              </Button>
            </div>
          </div>

          <div className='mt-3 flex justify-end text-[11px] leading-5 text-[var(--ed-ink-faint)]'>
            <Link
              to='/projects?create=1'
              className='group/blank inline-flex shrink-0 items-center gap-1 text-[var(--ed-ink-muted)] outline-none hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              从空白画布开始
              <ArrowRight className='size-3 transition-transform group-hover/blank:translate-x-0.5 motion-reduce:transition-none' />
            </Link>
          </div>
        </form>
      </section>

      <div className='mx-auto mt-12 w-full max-w-[660px] space-y-9'>
        <section aria-labelledby='recent-projects-title' className='ed-home-recent-projects'>
          <div className='mb-4 flex items-center justify-between gap-5'>
            <h2 id='recent-projects-title' className='text-[13px] font-medium text-[var(--ed-ink-muted)]'>
              最近项目
            </h2>
            <Link
              to='/projects'
              className='group/all flex items-center gap-1 text-[11px] text-[var(--ed-ink-muted)] outline-none hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              查看全部
              <ArrowRight className='size-3 transition-transform group-hover/all:translate-x-0.5 motion-reduce:transition-none' />
            </Link>
          </div>

          {projectLoadError ? (
            <div className='flex min-h-[88px] items-center justify-between gap-4 rounded-[8px] bg-[#321b22]/55 px-4 shadow-[inset_0_0_0_1px_rgba(255,127,138,.18)]'>
              <div>
                <p role='alert' className='text-xs text-[#ffabb2]'>
                  {projectLoadError}
                </p>
                <p className='mt-1 text-[11px] text-[#b98f96]'>最近项目暂时没有更新，已加载的内容会继续保留。</p>
              </div>
              <Button
                type='button'
                variant='outline'
                onClick={() => void loadProjects()}
                className='h-8 shrink-0 rounded-[6px] border-[#67404a] bg-transparent text-xs text-[#ffc3c8]'
              >
                重试
              </Button>
            </div>
          ) : loading && recentDesigns.length === 0 ? (
            <div className='grid grid-cols-3 gap-3'>
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className='aspect-[1.7] animate-pulse rounded-[8px] bg-[var(--ed-panel)] motion-reduce:animate-none'
                />
              ))}
            </div>
          ) : recentDesigns.length > 0 ? (
            <div className='grid grid-cols-3 gap-3'>
              {recentDesigns.slice(0, 3).map(project => (
                <Link
                  key={project.id}
                  to={resolveRecentProjectTarget(project.id, recentConversations)}
                  className='group/project overflow-hidden rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)] outline-none transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[#39536b] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)] motion-reduce:transition-none'
                  aria-label={`继续项目 ${project.name}`}
                >
                  <ProjectThumbnail project={project} className='aspect-[2.1]' />
                  <div className='flex items-center gap-3 border-t border-[var(--ed-line)] px-2.5 py-1.5'>
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-xs font-medium text-[var(--ed-ink)]'>{project.name}</p>
                      <p className='mt-0.5 text-[10px] text-[var(--ed-ink-faint)]'>{project.pageCount} 个页面</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className='grid min-h-[120px] place-items-center rounded-[8px] border border-dashed border-[var(--ed-line-strong)] text-center'>
              <div>
                <p className='text-xs text-[var(--ed-ink-muted)]'>还没有项目</p>
                <Link
                  to='/projects?create=1'
                  className='mt-2 inline-flex text-[11px] text-[var(--ed-cyan)] hover:text-[#b8f4ff]'
                >
                  从空白画布开始
                </Link>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby='recent-conversations-title' className='ed-home-recent-conversations'>
          <div className='mb-3 flex items-center justify-between gap-5'>
            <h2 id='recent-conversations-title' className='text-[13px] font-medium text-[var(--ed-ink-muted)]'>
              最近对话
            </h2>
            <span className='text-[10px] text-[var(--ed-ink-faint)]'>仅你可见</span>
          </div>

          {recentConversations.length > 0 ? (
            <div className='overflow-hidden border-y border-[var(--ed-line)]'>
              {recentConversations.slice(0, 4).map((conversation, index) => (
                <Link
                  key={conversation.id}
                  to={`/projects/${conversation.projectId}/agent/${conversation.id}`}
                  className={`group/conversation grid min-h-[50px] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 px-1 outline-none transition-colors hover:bg-[var(--ed-panel)]/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ed-cyan)] ${index > 0 ? 'border-t border-[var(--ed-line)]' : ''}`}
                >
                  <MessageSquareText
                    className='size-3.5 text-[var(--ed-ink-faint)] group-hover/conversation:text-[var(--ed-cyan)]'
                    aria-hidden='true'
                  />
                  <span className='truncate text-xs font-medium text-[var(--ed-ink)]'>{conversation.title}</span>
                  <span className='font-mono text-[10px] text-[var(--ed-ink-faint)]'>
                    {formatProjectTime(conversation.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className='grid min-h-[104px] place-items-center border-y border-dashed border-[var(--ed-line-strong)] text-center'>
              <div>
                <MessageSquareText className='mx-auto size-5 text-[var(--ed-ink-faint)]' aria-hidden='true' />
                <p className='mt-3 text-xs text-[var(--ed-ink-muted)]'>还没有最近对话</p>
                <p className='mt-1 text-[11px] text-[var(--ed-ink-faint)]'>从上方描述一个大屏目标即可开始。</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
