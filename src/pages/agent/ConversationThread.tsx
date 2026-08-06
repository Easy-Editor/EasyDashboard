import { BrandMark } from '@/components/brand/BrandMark'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AGENT_ATTACHMENT_ACCEPT,
  AGENT_ATTACHMENT_FORMAT_LABEL,
  type AgentAttachmentInput,
  type AgentAttachmentScope,
  type AgentBudgetUsage,
  type AgentConversation,
  type AgentMessage,
  type AgentTask,
  type AgentTaskPublicEvent,
  getAgentBudgetUsage,
} from '@/features/agent'
import { resolveQuestionChoices } from '@/features/agent/question-choices'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  CornerDownLeft,
  FileText,
  FolderInput,
  LoaderCircle,
  LockKeyhole,
  MessageCircleQuestion,
  Paperclip,
  RotateCw,
  Send,
  SquarePen,
  X,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { type UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TaskThread } from './TaskThread'
import {
  type AttachmentDraft,
  createAttachmentDrafts,
  formatCompactTime,
  toAgentFileSelections,
  toAttachmentInputs,
} from './project-agent-model'

const CHAT_DOCK_MIN_WIDTH = 360
const CHAT_DOCK_MAX_WIDTH = 560
const CHAT_DOCK_DEFAULT_WIDTH = 448
const CHAT_DOCK_KEYBOARD_STEP = 16
const CONVERSATION_BOTTOM_THRESHOLD = 48
const EMPTY_PROMPTS = ['根据附件搭建一版运营大屏', '优化当前画面的信息层级', '调整配色并强化关键指标'] as const

type ScrollMetrics = Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>

type ConversationTimelineItem =
  | { kind: 'message'; id: string; createdAt: string; message: AgentMessage }
  | { kind: 'activity'; id: string; createdAt: string; task: AgentTask; activity: AgentTaskPublicEvent }

const ACTIVE_TASK_STATUSES = new Set<AgentTask['status']>(['waiting', 'waiting_user', 'paused', 'running'])
const RUNNING_ACTIVITY_TYPES = new Set<AgentTaskPublicEvent['type']>([
  'plan_created',
  'plan_revised',
  'step_started',
  'change_prepared',
  'preview_checked',
  'step_revising',
  'rollback_started',
])
const WARNING_ACTIVITY_TYPES = new Set<AgentTaskPublicEvent['type']>([
  'material_gap',
  'waiting_user',
  'rollback_blocked',
])
const FAILED_ACTIVITY_TYPES = new Set<AgentTaskPublicEvent['type']>(['task_failed'])
const TRANSIENT_ACTIVITY_TYPES = new Set<AgentTaskPublicEvent['type']>([
  'step_started',
  'change_prepared',
  'step_revising',
])
const STEP_SETTLED_ACTIVITY_TYPES = new Set<AgentTaskPublicEvent['type']>([
  'change_committed',
  'step_passed',
  'step_superseded',
  'task_failed',
  'task_completed',
])

export function isConversationNearBottom(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= CONVERSATION_BOTTOM_THRESHOLD
}

export function shouldShowTaskTodo(task: AgentTask | undefined, preferenceEnabled: boolean): task is AgentTask {
  return Boolean(
    task &&
      preferenceEnabled &&
      task.status !== 'waiting_user' &&
      ACTIVE_TASK_STATUSES.has(task.status) &&
      (task.activePlan?.steps ?? task.plan?.steps ?? task.stages).length > 1,
  )
}

export { resolveQuestionChoices }

export function resolveConversationTimelineItems(conversation: AgentConversation): ConversationTimelineItem[] {
  const messages: ConversationTimelineItem[] = conversation.messages.map(message => ({
    kind: 'message',
    id: `message:${message.id}`,
    createdAt: message.createdAt,
    message,
  }))
  const activities: ConversationTimelineItem[] = conversation.tasks.flatMap(task => {
    const activeStepIds = new Set(
      (task.activePlan?.steps ?? [])
        .filter(step => ['running', 'verifying', 'revising'].includes(step.status))
        .map(step => step.id),
    )
    const latestTransientByStep = new Map<string, AgentTaskPublicEvent>()
    const latestSettledSequenceByStep = new Map<string, number>()
    for (const activity of task.activities ?? []) {
      if (TRANSIENT_ACTIVITY_TYPES.has(activity.type)) {
        latestTransientByStep.set(activity.stepId ?? task.id, activity)
      }
      if (STEP_SETTLED_ACTIVITY_TYPES.has(activity.type)) {
        const key = activity.stepId ?? task.id
        latestSettledSequenceByStep.set(key, Math.max(latestSettledSequenceByStep.get(key) ?? 0, activity.seq))
      }
    }
    return (task.activities ?? [])
      .filter(activity => {
        if (activity.type === 'waiting_user') return false
        if (!TRANSIENT_ACTIVITY_TYPES.has(activity.type)) return true
        if ((latestSettledSequenceByStep.get(activity.stepId ?? task.id) ?? 0) > activity.seq) return false
        const isTaskActivelyExecuting = ['waiting', 'running'].includes(task.status)
        const isCurrentStep = task.activePlan
          ? isTaskActivelyExecuting && Boolean(activity.stepId && activeStepIds.has(activity.stepId))
          : task.status === 'running'
        return isCurrentStep && latestTransientByStep.get(activity.stepId ?? task.id)?.eventKey === activity.eventKey
      })
      .map(activity => ({
        kind: 'activity' as const,
        id: `activity:${activity.taskRunId}:${activity.eventKey}`,
        createdAt: activity.createdAt,
        task,
        activity,
      }))
  })

  return [...messages, ...activities].sort((left, right) => {
    if (left.kind === 'activity' && right.kind === 'activity' && left.task.id === right.task.id) {
      return left.activity.seq - right.activity.seq
    }
    if (left.kind === 'message' && right.kind === 'activity' && left.message.taskId === right.task.id) return -1
    if (left.kind === 'activity' && right.kind === 'message' && right.message.taskId === left.task.id) return 1
    const byTime = Date.parse(left.createdAt) - Date.parse(right.createdAt)
    if (byTime !== 0) return byTime
    if (left.kind === right.kind) {
      if (left.kind === 'activity' && right.kind === 'activity') return left.activity.seq - right.activity.seq
      return left.id.localeCompare(right.id)
    }
    return left.kind === 'message' ? -1 : 1
  })
}

function activityChangeDescription(activity: AgentTaskPublicEvent): string | null {
  const payload = activity.publicPayload.changeCounts
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const labels: Record<string, string> = {
    add: '新增',
    configure: '更新配置',
    move: '调整位置',
    resize: '调整尺寸',
    reorder: '调整层级',
    remove: '移除',
  }
  const parts = Object.entries(payload as Record<string, unknown>).flatMap(([key, value]) =>
    typeof value === 'number' && value > 0 && labels[key] ? [`${labels[key]} ${value} 项`] : [],
  )
  return parts.length ? parts.join('，') : null
}

export function resolveActivityPresentation(task: AgentTask, activity: AgentTaskPublicEvent) {
  const stepTitle = task.activePlan?.steps.find(step => step.id === activity.stepId)?.title
  const changeDescription = activityChangeDescription(activity)
  if (activity.type === 'waiting_user') {
    return {
      status: '需要你的回复',
      title: stepTitle ?? '继续当前任务',
      detail: task.pendingQuestion?.prompt ?? activity.summary,
    }
  }
  if (activity.type === 'step_started' || activity.type === 'change_prepared') {
    return {
      status: '正在修改',
      title: stepTitle ?? '当前画布内容',
      detail: changeDescription ? `${changeDescription}，完成后同步到右侧画布。` : 'Agent 正在把这一步应用到右侧画布。',
    }
  }
  if (activity.type === 'step_revising') {
    return {
      status: '正在重新调整',
      title: stepTitle ?? '当前步骤',
      detail: '上一次修改没有形成可用结果，Agent 正在调整执行方式。',
    }
  }
  if (activity.type === 'change_committed') {
    return {
      status: '已更新画布',
      title: stepTitle ?? '当前步骤',
      detail: changeDescription ? `${changeDescription}，已同步到右侧草稿。` : '本轮修改已同步到右侧草稿。',
    }
  }
  if (activity.type === 'step_passed') {
    return {
      status: '检查通过',
      title: stepTitle ?? '当前步骤',
      detail: '画布结果与本步目标一致，Agent 将继续后续工作。',
    }
  }
  return {
    status: RUNNING_ACTIVITY_TYPES.has(activity.type) ? 'Agent 正在处理' : 'Agent 进度',
    title: stepTitle ?? activity.summary,
    detail: stepTitle && activity.summary !== stepTitle ? activity.summary : null,
  }
}

function clampChatDockWidth(width: number): number {
  return Math.min(CHAT_DOCK_MAX_WIDTH, Math.max(CHAT_DOCK_MIN_WIDTH, width))
}

function AttachmentList({ message }: { message: AgentMessage }) {
  if (message.attachments.length === 0) return null

  return (
    <ul className='mt-3 space-y-1.5'>
      {message.attachments.map(attachment => (
        <li
          key={attachment.id}
          className='flex items-center gap-2.5 rounded-[6px] border border-[var(--ed-line)] bg-[var(--ed-panel)] px-2.5 py-2'
        >
          <FileText className='size-3.5 shrink-0 text-[var(--ed-ink-faint)]' aria-hidden='true' />
          <span className='min-w-0 flex-1 truncate text-[11px] text-[var(--ed-ink-muted)]'>{attachment.name}</span>
          <span className='shrink-0 text-[10px] text-[var(--ed-ink-faint)]'>
            {attachment.scope === 'project' ? '项目文件' : '仅本对话'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function MessageBlock({
  message,
  index,
  reduceMotion,
}: { message: AgentMessage; index: number; reduceMotion: boolean }) {
  if (message.role === 'system') {
    return (
      <motion.article
        className='flex items-start gap-2.5 border-l border-[var(--ed-line-strong)] pl-3 text-[11px] leading-5 text-[var(--ed-ink-faint)]'
        initial={reduceMotion ? false : { opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduceMotion ? 0 : 0.18,
          delay: reduceMotion ? 0 : Math.min(index * 0.025, 0.12),
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        <span className='min-w-0 flex-1 whitespace-pre-wrap'>{message.content}</span>
        <time className='shrink-0 font-mono text-[9px]'>{formatCompactTime(message.createdAt)}</time>
      </motion.article>
    )
  }

  if (message.role === 'user') {
    return (
      <motion.article
        className='flex flex-col items-end'
        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduceMotion ? 0 : 0.2,
          delay: reduceMotion ? 0 : Math.min(index * 0.025, 0.12),
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        <div className='max-w-[88%] rounded-[9px_9px_3px_9px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] px-3.5 py-3'>
          {message.content ? (
            <p className='whitespace-pre-wrap text-[13px] leading-[1.65] text-[var(--ed-ink-soft)]'>
              {message.content}
            </p>
          ) : null}
          <AttachmentList message={message} />
        </div>
        <time className='mt-1.5 pr-1 font-mono text-[9px] text-[var(--ed-ink-faint)]'>
          {formatCompactTime(message.createdAt)}
        </time>
      </motion.article>
    )
  }

  return (
    <motion.article
      className='group'
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduceMotion ? 0 : 0.2,
        delay: reduceMotion ? 0 : Math.min(index * 0.025, 0.12),
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <div className='flex items-center gap-2'>
        <BrandMark compact className='[&>span]:size-6 [&_img]:h-[14px] [&_img]:w-[17px]' />
        <span className='text-[11px] font-medium text-[var(--ed-ink-soft)]'>EasyDashboard Agent</span>
        <time className='ml-auto font-mono text-[9px] text-[var(--ed-ink-faint)]'>
          {formatCompactTime(message.createdAt)}
        </time>
      </div>
      <div className='ml-8 mt-2 border-l border-[var(--ed-line)] pl-3.5'>
        {message.content ? (
          <p className='whitespace-pre-wrap text-[13px] leading-[1.7] text-[var(--ed-ink-soft)]'>{message.content}</p>
        ) : null}
        <AttachmentList message={message} />
      </div>
    </motion.article>
  )
}

function ActivityIcon({ task, activity }: { task: AgentTask; activity: AgentTaskPublicEvent }) {
  const isCurrentRunningActivity = task.status === 'running' && task.activities?.at(-1)?.eventKey === activity.eventKey
  if (RUNNING_ACTIVITY_TYPES.has(activity.type) && isCurrentRunningActivity) {
    return (
      <LoaderCircle
        className='size-3.5 animate-spin text-[var(--ed-cyan)] motion-reduce:animate-none'
        aria-hidden='true'
      />
    )
  }
  if (FAILED_ACTIVITY_TYPES.has(activity.type)) {
    return <AlertCircle className='size-3.5 text-[var(--ed-error)]' aria-hidden='true' />
  }
  if (WARNING_ACTIVITY_TYPES.has(activity.type)) {
    return <MessageCircleQuestion className='size-3.5 text-[var(--ed-warning)]' aria-hidden='true' />
  }
  return <CheckCircle2 className='size-3.5 text-[var(--ed-success)]' aria-hidden='true' />
}

function AgentActivityBlock({
  task,
  activity,
  index,
  reduceMotion,
  continuation,
}: {
  task: AgentTask
  activity: AgentTaskPublicEvent
  index: number
  reduceMotion: boolean
  continuation: boolean
}) {
  const presentation = resolveActivityPresentation(task, activity)

  return (
    <motion.article
      data-agent-activity={activity.type}
      className={continuation ? '-mt-3 group' : 'group'}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduceMotion ? 0 : 0.2,
        delay: reduceMotion ? 0 : Math.min(index * 0.025, 0.12),
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {continuation ? null : (
        <div className='flex items-center gap-2'>
          <BrandMark compact className='[&>span]:size-6 [&_img]:h-[14px] [&_img]:w-[17px]' />
          <span className='text-[11px] font-medium text-[var(--ed-ink-soft)]'>EasyDashboard Agent</span>
          <time className='ml-auto font-mono text-[9px] text-[var(--ed-ink-faint)]'>
            {formatCompactTime(activity.createdAt)}
          </time>
        </div>
      )}
      <div className={`ml-8 border-l border-[var(--ed-line)] pl-3.5 ${continuation ? '' : 'mt-2'}`}>
        <div className='flex items-start gap-2'>
          <span className='mt-[3px] shrink-0'>
            <ActivityIcon task={task} activity={activity} />
          </span>
          <div className='min-w-0 flex-1'>
            <p className='text-[10px] font-medium leading-4 text-[var(--ed-cyan)]'>{presentation.status}</p>
            <p className='mt-0.5 whitespace-pre-wrap text-[12px] font-medium leading-5 text-[var(--ed-ink-soft)]'>
              {presentation.title}
            </p>
            {presentation.detail ? (
              <p className='mt-0.5 whitespace-pre-wrap text-[10px] leading-4 text-[var(--ed-ink-faint)]'>
                {presentation.detail}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </motion.article>
  )
}

function AgentPendingBlock({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.article
      data-agent-pending='true'
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className='flex items-center gap-2'>
        <BrandMark compact className='[&>span]:size-6 [&_img]:h-[14px] [&_img]:w-[17px]' />
        <span className='text-[11px] font-medium text-[var(--ed-ink-soft)]'>EasyDashboard Agent</span>
      </div>
      <div className='ml-8 mt-2 flex items-start gap-2 border-l border-[var(--ed-line)] pl-3.5'>
        <LoaderCircle
          className='mt-[3px] size-3.5 shrink-0 animate-spin text-[var(--ed-cyan)] motion-reduce:animate-none'
          aria-hidden='true'
        />
        <div>
          <p className='text-[10px] font-medium leading-4 text-[var(--ed-cyan)]'>Agent 正在思考</p>
          <p className='mt-0.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>正在理解你的要求并准备下一步操作。</p>
        </div>
      </div>
    </motion.article>
  )
}

function ConversationTimeline({
  conversation,
  reduceMotion,
  planPending,
}: { conversation: AgentConversation; reduceMotion: boolean; planPending: boolean }) {
  const items = resolveConversationTimelineItems(conversation)
  const showPendingAgent = planPending && items.at(-1)?.kind === 'message'
  return (
    <div aria-live='polite' aria-relevant='additions text' className='space-y-6 px-5 py-6'>
      {items.map((item, index) => {
        if (item.kind === 'message') {
          return <MessageBlock key={item.id} message={item.message} index={index} reduceMotion={reduceMotion} />
        }
        const previousItem = items[index - 1]
        const continuation = previousItem?.kind === 'activity' && previousItem.task.id === item.task.id
        return (
          <AgentActivityBlock
            key={item.id}
            task={item.task}
            activity={item.activity}
            index={index}
            reduceMotion={reduceMotion}
            continuation={continuation}
          />
        )
      })}
      {showPendingAgent ? <AgentPendingBlock reduceMotion={reduceMotion} /> : null}
    </div>
  )
}

function formatBudgetUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`
}

function BudgetMeter({ label, usage }: { label: string; usage: AgentBudgetUsage['task'] }) {
  const percent = Math.round(usage.ratio * 100)
  const warning = usage.state !== 'ok'
  return (
    <div>
      <div className='flex items-center justify-between gap-2 text-[10px]'>
        <span className='text-[var(--ed-ink-muted)]'>{label}</span>
        <span className={warning ? 'font-mono text-[var(--ed-warning)]' : 'font-mono text-[var(--ed-ink-faint)]'}>
          {formatBudgetUsd(usage.usedMicros)} / {formatBudgetUsd(usage.limitMicros)} · {percent}%
        </span>
      </div>
      <div
        role='progressbar'
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        tabIndex={0}
        className='mt-1 h-1 overflow-hidden rounded-full bg-[var(--ed-line)]'
      >
        <div
          className={`h-full rounded-full ${warning ? 'bg-[var(--ed-warning)]' : 'bg-[var(--ed-cyan)]'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export function ConversationThread({
  conversation,
  conversations,
  defaultAttachmentScope,
  notice,
  planPending,
  retryLabel,
  retryPending,
  showTaskProgress,
  onCreateConversation,
  onRenameConversation,
  onRetry,
  onRollback,
  onResumeTask,
  resumePendingTaskRunId,
  rollbackPendingOperationId,
  rolledBackOperationIds,
  onSelectConversation,
  onSend,
}: {
  conversation: AgentConversation | null
  conversations: AgentConversation[]
  defaultAttachmentScope: AgentAttachmentScope
  notice: string | null
  planPending: boolean
  retryLabel?: string
  retryPending: boolean
  showTaskProgress: boolean
  onCreateConversation: () => void
  onRenameConversation?: (title: string) => void
  onRetry?: () => Promise<void>
  onRollback: (operationId: string) => void
  onResumeTask: (taskRunId: string) => void
  resumePendingTaskRunId: string | null
  rollbackPendingOperationId: string | null
  rolledBackOperationIds: Set<string>
  onSelectConversation: (conversationId: string) => void
  onSend: (
    content: string,
    attachments: AgentAttachmentInput[],
    files: ReturnType<typeof toAgentFileSelections>,
  ) => Promise<void>
}) {
  const [content, setContent] = useState('')
  const [attachmentScope, setAttachmentScope] = useState<AgentAttachmentScope>(defaultAttachmentScope)
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([])
  const [budgetUsage, setBudgetUsage] = useState<AgentBudgetUsage | null>(null)
  const [dockWidth, setDockWidth] = useState(CHAT_DOCK_DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editingTitle) return
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }, [editingTitle])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const shouldFollowMessagesRef = useRef(true)
  const lastConversationIdRef = useRef<string | null>(null)
  const budgetRequestIdRef = useRef(0)
  const resizeStartRef = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const reduceMotion = useReducedMotion()
  const currentProjectId = conversation?.projectId
  const currentTaskId = conversation?.tasks.at(-1)?.id
  const latestTask = conversation?.tasks.at(-1)
  const pendingQuestion = latestTask?.status === 'waiting_user' ? latestTask.pendingQuestion : undefined
  const questionChoices = pendingQuestion ? resolveQuestionChoices(pendingQuestion.prompt) : []
  const conversationId = conversation?.id ?? null
  const latestTimelineItem = conversation ? resolveConversationTimelineItems(conversation).at(-1) : undefined
  const latestMessageRevision = latestTimelineItem?.id ?? null
  const budgetNeedsAttention =
    budgetUsage !== null && (budgetUsage.task.state !== 'ok' || budgetUsage.projectMonth.state !== 'ok')
  const budgetRequestKey =
    currentProjectId && currentTaskId
      ? `${currentProjectId}:${currentTaskId}:${conversation?.tasks.at(-1)?.updatedAt ?? ''}`
      : null

  const loadBudgetUsage = useCallback(async () => {
    const requestId = ++budgetRequestIdRef.current
    if (!budgetRequestKey || !currentProjectId || !currentTaskId) {
      setBudgetUsage(null)
      return
    }
    try {
      const usage = await getAgentBudgetUsage(currentProjectId, currentTaskId)
      if (requestId === budgetRequestIdRef.current) setBudgetUsage(usage)
    } catch {
      if (requestId === budgetRequestIdRef.current) setBudgetUsage(null)
    }
  }, [budgetRequestKey, currentProjectId, currentTaskId])

  useEffect(() => {
    setAttachmentScope(defaultAttachmentScope)
  }, [defaultAttachmentScope])

  useEffect(() => {
    void loadBudgetUsage()
  }, [loadBudgetUsage])

  useLayoutEffect(() => {
    const messageScroller = messageScrollRef.current
    const conversationChanged = lastConversationIdRef.current !== conversationId
    lastConversationIdRef.current = conversationId

    if (!messageScroller || !conversationId || !latestMessageRevision) return
    if (conversationChanged) shouldFollowMessagesRef.current = true

    if (conversationChanged || shouldFollowMessagesRef.current) {
      messageScroller.scrollTop = messageScroller.scrollHeight
    }
  }, [conversationId, latestMessageRevision])

  const handleMessageScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    shouldFollowMessagesRef.current = isConversationNearBottom(event.currentTarget)
  }, [])

  const send = async () => {
    if ((!content.trim() && attachments.length === 0) || planPending) return
    const nextContent = content.trim()
    const nextAttachments = toAttachmentInputs(attachments)
    const files = toAgentFileSelections(attachments)
    setContent('')
    setAttachments([])
    try {
      await onSend(nextContent, nextAttachments, files)
    } catch {
      setContent(nextContent)
      setAttachments(attachments)
    }
  }

  const selectFiles = (files: FileList | null) => {
    if (!files) return
    setAttachments(current => [...current, ...createAttachmentDrafts(files, attachmentScope)])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const stopResize = (pointerId: number) => {
    if (resizeStartRef.current?.pointerId !== pointerId) return
    resizeStartRef.current = null
    setIsResizing(false)
  }

  return (
    <motion.section
      aria-label='当前对话'
      className='relative flex min-h-0 shrink-0 flex-col border-r border-[var(--ed-line-strong)] bg-[var(--ed-panel)]'
      initial={false}
      animate={{ width: dockWidth }}
      transition={{ duration: reduceMotion || isResizing ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
      style={{ minWidth: CHAT_DOCK_MIN_WIDTH, maxWidth: CHAT_DOCK_MAX_WIDTH }}
    >
      <motion.hr
        aria-label='调整对话栏宽度'
        aria-orientation='vertical'
        aria-valuemin={CHAT_DOCK_MIN_WIDTH}
        aria-valuemax={CHAT_DOCK_MAX_WIDTH}
        aria-valuenow={dockWidth}
        tabIndex={0}
        title='拖拽调整对话栏宽度，方向键微调'
        className='absolute inset-y-0 right-[-5px] z-20 w-[10px] cursor-col-resize touch-none border-0 bg-[linear-gradient(to_right,transparent_4px,var(--ed-line-strong)_4px,var(--ed-line-strong)_5px,transparent_5px)] outline-none hover:bg-[linear-gradient(to_right,transparent_4px,var(--ed-cyan)_4px,var(--ed-cyan)_5px,transparent_5px)] focus-visible:bg-[linear-gradient(to_right,transparent_3px,var(--ed-cyan)_3px,var(--ed-cyan)_6px,transparent_6px)] motion-reduce:transition-none'
        animate={{ opacity: isResizing ? 1 : 0.58, scaleX: isResizing ? 1.2 : 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.14, ease: 'easeOut' }}
        onPointerDown={event => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          resizeStartRef.current = { pointerId: event.pointerId, x: event.clientX, width: dockWidth }
          setIsResizing(true)
        }}
        onPointerMove={event => {
          const start = resizeStartRef.current
          if (!start || start.pointerId !== event.pointerId) return
          setDockWidth(clampChatDockWidth(start.width + event.clientX - start.x))
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          stopResize(event.pointerId)
        }}
        onPointerCancel={event => stopResize(event.pointerId)}
        onKeyDown={event => {
          const step = event.shiftKey ? CHAT_DOCK_KEYBOARD_STEP * 2 : CHAT_DOCK_KEYBOARD_STEP
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            setDockWidth(current => clampChatDockWidth(current - step))
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            setDockWidth(current => clampChatDockWidth(current + step))
          } else if (event.key === 'Home') {
            event.preventDefault()
            setDockWidth(CHAT_DOCK_MIN_WIDTH)
          } else if (event.key === 'End') {
            event.preventDefault()
            setDockWidth(CHAT_DOCK_MAX_WIDTH)
          }
        }}
      />
      <div className='flex h-16 shrink-0 items-center gap-2 border-b border-[var(--ed-line)] px-3.5'>
        {editingTitle ? (
          <form
            className='flex min-w-0 flex-1 items-center gap-1.5'
            onSubmit={event => {
              event.preventDefault()
              if (!titleDraft.trim()) return
              onRenameConversation?.(titleDraft)
              setEditingTitle(false)
            }}
          >
            <label className='sr-only' htmlFor='agent-conversation-title'>
              对话名称
            </label>
            <input
              ref={titleInputRef}
              id='agent-conversation-title'
              value={titleDraft}
              maxLength={80}
              onChange={event => setTitleDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') setEditingTitle(false)
              }}
              className='h-10 min-w-0 flex-1 rounded-[6px] border border-[var(--ed-cyan)] bg-[var(--ed-panel-raised)] px-2.5 text-[13px] text-[var(--ed-ink)] outline-none ring-2 ring-[var(--ed-cyan)]/10'
            />
            <button
              type='submit'
              aria-label='保存对话名称'
              disabled={!titleDraft.trim()}
              className='grid size-9 place-items-center rounded-[6px] text-[var(--ed-cyan)] hover:bg-[var(--ed-panel-raised)] disabled:opacity-40'
            >
              <Check className='size-4' aria-hidden='true' />
            </button>
            <button
              type='button'
              aria-label='取消重命名'
              onClick={() => setEditingTitle(false)}
              className='grid size-9 place-items-center rounded-[6px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)]'
            >
              <X className='size-4' aria-hidden='true' />
            </button>
          </form>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                aria-label='切换对话'
                className='group flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[7px] px-2.5 text-left outline-none transition-colors hover:bg-[var(--ed-panel-raised)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)] data-[state=open]:bg-[var(--ed-panel-raised)]'
              >
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-[13px] font-medium text-[var(--ed-ink)]'>
                    {conversation?.title ?? '新对话'}
                  </span>
                  <span className='mt-0.5 block text-[10px] text-[var(--ed-ink-faint)]'>
                    仅你可见 · 同一对话持续执行
                  </span>
                </span>
                <ChevronDown
                  className='size-3.5 shrink-0 text-[var(--ed-ink-faint)] transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none'
                  aria-hidden='true'
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              data-ed-shell='agent'
              align='start'
              sideOffset={6}
              className='w-[var(--radix-dropdown-menu-trigger-width)] min-w-[320px] max-w-[410px] rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] p-1.5 text-[var(--ed-ink)] shadow-[0_18px_48px_rgba(0,0,0,.42)]'
            >
              <DropdownMenuLabel className='px-2 py-1.5 text-[10px] font-medium text-[var(--ed-ink-faint)]'>
                项目对话
              </DropdownMenuLabel>
              <DropdownMenuSeparator className='bg-[var(--ed-line)]' />
              {conversations.map(candidate => {
                const active = candidate.id === conversation?.id
                return (
                  <DropdownMenuItem
                    key={candidate.id}
                    onSelect={() => onSelectConversation(candidate.id)}
                    className='min-h-10 rounded-[6px] px-2 py-2 focus:bg-[var(--ed-panel-raised)] focus:text-[var(--ed-ink)]'
                  >
                    <Check
                      className={`size-3.5 shrink-0 ${active ? 'text-[var(--ed-cyan)]' : 'text-transparent'}`}
                      aria-hidden='true'
                    />
                    <span className='min-w-0 flex-1 truncate text-[11px] text-[var(--ed-ink-soft)]'>
                      {candidate.title}
                    </span>
                    <time className='shrink-0 font-mono text-[9px] text-[var(--ed-ink-faint)]'>
                      {formatCompactTime(candidate.updatedAt)}
                    </time>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!editingTitle && conversation && onRenameConversation ? (
          <button
            type='button'
            aria-label='重命名当前对话'
            title='重命名当前对话'
            onClick={() => {
              setTitleDraft(conversation.title)
              setEditingTitle(true)
            }}
            className='grid size-9 shrink-0 place-items-center rounded-[6px] text-[var(--ed-ink-faint)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
          >
            <SquarePen className='size-3.5' aria-hidden='true' />
          </button>
        ) : null}
        <button
          type='button'
          aria-label='新建对话'
          title='新建对话'
          onClick={onCreateConversation}
          className='inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[11px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
        >
          <SquarePen className='size-3.5' aria-hidden='true' />
          新对话
        </button>
      </div>
      <div
        ref={messageScrollRef}
        data-agent-message-scroll='true'
        onScroll={handleMessageScroll}
        className='min-h-0 flex-1 overscroll-contain overflow-y-auto bg-[var(--ed-rail)] pb-12'
      >
        {conversation && resolveConversationTimelineItems(conversation).length > 0 ? (
          <ConversationTimeline
            conversation={conversation}
            reduceMotion={Boolean(reduceMotion)}
            planPending={planPending}
          />
        ) : (
          <div className='grid h-full min-h-72 place-items-center px-6 py-8'>
            <div className='w-full max-w-sm'>
              <BrandMark compact className='[&>span]:size-7 [&_img]:h-[17px] [&_img]:w-[20px]' />
              <p className='mt-4 text-[15px] font-medium text-[var(--ed-ink)]'>从一个清楚的目标开始</p>
              <p className='mt-2 max-w-xs text-[11px] leading-5 text-[var(--ed-ink-faint)]'>
                Agent 会理解需求、安排步骤，并把结果直接更新到右侧草稿。
              </p>
              <div className='mt-5 space-y-2' aria-label='任务示例'>
                {EMPTY_PROMPTS.map(prompt => (
                  <button
                    key={prompt}
                    type='button'
                    onClick={() => setContent(prompt)}
                    className='group flex w-full items-center justify-between gap-3 border-t border-[var(--ed-line)] py-2.5 text-left text-[11px] text-[var(--ed-ink-muted)] transition-colors hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ed-cyan)]'
                  >
                    {prompt}
                    <CornerDownLeft className='size-3 shrink-0 text-[var(--ed-ink-faint)] group-hover:text-[var(--ed-cyan)]' />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {notice ? (
        <div
          role='alert'
          className='flex items-start gap-2 border-t border-[color-mix(in_srgb,var(--ed-warning)_40%,var(--ed-line))] bg-[color-mix(in_srgb,var(--ed-warning)_7%,var(--ed-panel))] px-4 py-2.5'
        >
          <AlertTriangle className='mt-0.5 size-3.5 shrink-0 text-[var(--ed-warning)]' aria-hidden='true' />
          <p className='min-w-0 flex-1 text-[10px] leading-4 text-[var(--ed-ink-muted)]'>{notice}</p>
          {onRetry && retryLabel ? (
            <button
              type='button'
              disabled={retryPending}
              onClick={() => void onRetry()}
              className='inline-flex h-6 shrink-0 items-center gap-1 rounded-[5px] border border-[var(--ed-warning)]/35 px-2 text-[10px] text-[var(--ed-warning)] hover:bg-[var(--ed-warning)]/10 disabled:cursor-not-allowed disabled:opacity-50'
            >
              <RotateCw className={`size-3 ${retryPending ? 'animate-spin' : ''}`} aria-hidden='true' />
              {retryLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      {budgetUsage && budgetNeedsAttention ? (
        <aside
          aria-label='Agent 预算用量'
          className='space-y-2 border-t border-[var(--ed-line)] bg-[var(--ed-panel)] px-4 py-2.5'
        >
          <BudgetMeter label='当前任务' usage={budgetUsage.task} />
          <BudgetMeter label='本项目本月' usage={budgetUsage.projectMonth} />
          {budgetUsage.task.state !== 'ok' || budgetUsage.projectMonth.state !== 'ok' ? (
            <p role='alert' className='text-[10px] leading-4 text-[var(--ed-warning)]'>
              已达到预算的 {Math.round(budgetUsage.warningRatio * 100)}%，继续执行可能触发预算上限。
            </p>
          ) : null}
        </aside>
      ) : null}

      <div className='relative shrink-0 border-t border-[var(--ed-line)] bg-[var(--ed-panel)] px-3.5 py-3'>
        {pendingQuestion ? (
          <section
            data-agent-question='current'
            aria-label='Agent 等待你的选择'
            className='absolute bottom-[calc(100%+10px)] left-3.5 right-3.5 z-30 rounded-[9px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] p-3 shadow-[0_14px_36px_rgba(0,0,0,0.32)]'
          >
            <div className='flex items-start gap-2.5'>
              <MessageCircleQuestion className='mt-0.5 size-4 shrink-0 text-[var(--ed-cyan)]' aria-hidden='true' />
              <div className='min-w-0 flex-1'>
                <p className='text-[10px] font-medium text-[var(--ed-cyan)]'>需要你的选择</p>
                <p className='mt-1 text-[12px] leading-5 text-[var(--ed-ink-soft)]'>{pendingQuestion.prompt}</p>
              </div>
            </div>
            <div className='mt-3 grid gap-1.5'>
              {questionChoices.map(choice => {
                const selected = content.trim() === choice
                return (
                  <button
                    key={choice}
                    type='button'
                    aria-pressed={selected}
                    onClick={() => {
                      if (choice === '我需要补充说明') {
                        setContent('')
                      } else {
                        setContent(choice)
                      }
                      messageInputRef.current?.focus()
                    }}
                    className={`min-h-10 rounded-[6px] border px-3 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)] active:scale-[0.99] motion-reduce:transition-none ${
                      selected
                        ? 'border-[var(--ed-cyan)]/55 bg-[var(--ed-cyan)]/10 text-[var(--ed-ink)]'
                        : 'border-[var(--ed-line)] bg-[var(--ed-panel)] text-[var(--ed-ink-muted)] hover:border-[var(--ed-line-strong)] hover:text-[var(--ed-ink)]'
                    }`}
                  >
                    {choice}
                  </button>
                )
              })}
            </div>
            <p className='mt-2 text-[11px] text-[var(--ed-ink-faint)]'>也可以在下方输入自己的回答</p>
          </section>
        ) : null}
        {shouldShowTaskTodo(latestTask, showTaskProgress) ? (
          <div data-agent-todo='current' className='absolute bottom-[calc(100%+10px)] left-3.5 right-3.5 z-30'>
            <TaskThread
              task={latestTask}
              rollbackPending={rollbackPendingOperationId === latestTask.run?.operationId}
              rolledBack={latestTask.run ? rolledBackOperationIds.has(latestTask.run.operationId) : false}
              onRollback={onRollback}
              onResume={onResumeTask}
              resumePending={resumePendingTaskRunId === latestTask.taskRunId}
            />
          </div>
        ) : null}
        <div className='rounded-[10px] border border-[var(--ed-line-strong)] bg-[var(--ed-rail)] p-3 focus-within:border-[var(--ed-cyan)]/65 focus-within:ring-2 focus-within:ring-[var(--ed-cyan)]/10'>
          {attachments.length > 0 ? (
            <ul className='mb-2 flex flex-wrap gap-1.5'>
              {attachments.map(attachment => (
                <li
                  key={attachment.clientId}
                  className='flex max-w-full items-center gap-1.5 rounded-[5px] border border-[var(--ed-line)] bg-[var(--ed-panel-raised)] px-2 py-1'
                >
                  <FileText className='size-3 shrink-0 text-[var(--ed-ink-faint)]' aria-hidden='true' />
                  <span className='max-w-32 truncate text-[10px] text-[var(--ed-ink-muted)]'>{attachment.name}</span>
                  <button
                    type='button'
                    onClick={() =>
                      setAttachments(current =>
                        current.map(candidate =>
                          candidate.clientId === attachment.clientId
                            ? {
                                ...candidate,
                                scope: candidate.scope === 'conversation' ? 'project' : 'conversation',
                              }
                            : candidate,
                        ),
                      )
                    }
                    className='text-[10px] text-[var(--ed-cyan)] hover:underline'
                  >
                    {attachment.scope === 'project' ? '项目文件清单' : '仅本对话'}
                  </button>
                  <button
                    type='button'
                    aria-label={`移除${attachment.name}`}
                    onClick={() =>
                      setAttachments(current => current.filter(candidate => candidate.clientId !== attachment.clientId))
                    }
                    className='grid size-4 place-items-center text-[var(--ed-ink-faint)] hover:text-[var(--ed-error)]'
                  >
                    <X className='size-2.5' aria-hidden='true' />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <label className='sr-only' htmlFor='project-agent-message'>
            输入任务
          </label>
          <textarea
            ref={messageInputRef}
            id='project-agent-message'
            value={content}
            onChange={event => setContent(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder='描述你想创建或修改的大屏…'
            className='min-h-20 w-full resize-none bg-transparent px-0.5 py-0.5 text-[13px] leading-5 text-[var(--ed-ink)] outline-none placeholder:text-[var(--ed-ink-faint)]'
          />

          <div className='mt-2 flex items-center gap-2 border-t border-[var(--ed-line)] pt-2'>
            <input
              ref={fileInputRef}
              type='file'
              multiple
              accept={AGENT_ATTACHMENT_ACCEPT}
              className='sr-only'
              onChange={event => selectFiles(event.target.files)}
            />
            <button
              type='button'
              aria-label='添加文件清单'
              title={`支持 ${AGENT_ATTACHMENT_FORMAT_LABEL}`}
              onClick={() => fileInputRef.current?.click()}
              className='grid size-9 place-items-center rounded-[5px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              <Paperclip className='size-3.5' aria-hidden='true' />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  aria-label={`附件范围：${attachmentScope === 'conversation' ? '仅本对话' : '项目文件清单'}`}
                  className='flex h-9 items-center gap-1.5 rounded-[5px] border border-[var(--ed-line)] bg-[var(--ed-rail)] px-2.5 text-[11px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
                >
                  {attachmentScope === 'conversation' ? (
                    <LockKeyhole className='size-3' aria-hidden='true' />
                  ) : (
                    <FolderInput className='size-3' aria-hidden='true' />
                  )}
                  <span>{attachmentScope === 'conversation' ? '仅本对话' : '项目清单'}</span>
                  <ChevronDown className='size-3 text-[var(--ed-ink-faint)]' aria-hidden='true' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                data-ed-shell='agent'
                align='start'
                sideOffset={6}
                className='w-44 rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] p-1.5 text-[var(--ed-ink)] shadow-[0_18px_48px_rgba(0,0,0,.42)]'
              >
                <DropdownMenuLabel className='px-2 py-1.5 text-[10px] font-medium text-[var(--ed-ink-faint)]'>
                  附件范围
                </DropdownMenuLabel>
                <DropdownMenuSeparator className='bg-[var(--ed-line)]' />
                <DropdownMenuItem
                  onSelect={() => setAttachmentScope('conversation')}
                  className='min-h-9 rounded-[6px] px-2 focus:bg-[var(--ed-panel-raised)] focus:text-[var(--ed-ink)]'
                >
                  <Check
                    className={`size-3.5 ${attachmentScope === 'conversation' ? 'text-[var(--ed-cyan)]' : 'text-transparent'}`}
                    aria-hidden='true'
                  />
                  <LockKeyhole className='size-3.5 text-[var(--ed-ink-faint)]' aria-hidden='true' />
                  <span className='text-[11px]'>仅本对话</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setAttachmentScope('project')}
                  className='min-h-9 rounded-[6px] px-2 focus:bg-[var(--ed-panel-raised)] focus:text-[var(--ed-ink)]'
                >
                  <Check
                    className={`size-3.5 ${attachmentScope === 'project' ? 'text-[var(--ed-cyan)]' : 'text-transparent'}`}
                    aria-hidden='true'
                  />
                  <FolderInput className='size-3.5 text-[var(--ed-ink-faint)]' aria-hidden='true' />
                  <span className='text-[11px]'>加入项目文件清单</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className='ml-auto flex items-center gap-1 text-[10px] text-[var(--ed-ink-faint)]'>
              <CornerDownLeft className='size-3' aria-hidden='true' />
              Enter 发送
            </span>
            <button
              type='button'
              aria-label='发送'
              disabled={(!content.trim() && attachments.length === 0) || planPending}
              onClick={() => void send()}
              className='grid size-9 place-items-center rounded-[6px] bg-[var(--ed-ink)] text-[var(--ed-canvas)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              <Send className='size-3.5' aria-hidden='true' />
            </button>
          </div>
        </div>
      </div>
    </motion.section>
  )
}
