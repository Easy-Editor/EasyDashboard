import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/useAuth'
import { useEditorSession } from '@/contexts/editor-session-context'
import {
  AGENT_ATTACHMENT_ACCEPT,
  AGENT_ATTACHMENT_FORMAT_LABEL,
  type AgentAttachmentInput,
  type AgentConversation,
  type AgentPreferences,
  type AgentTaskStageStatus,
  type AgentTaskStatus,
  DEFAULT_AGENT_PREFERENCES,
  appendAgentTurn,
  buildProjectMemoryProposal,
  cancelAgentTaskRun,
  connectAgentWorkspaceSync,
  controlAgentRun,
  createAgentConversation,
  getAgentRun,
  getProjectAttachmentManifest,
  getProjectContexts,
  getProjectConversations,
  getTaskUserMessage,
  hasAgentWorkspaceRecovery,
  listSharedProjectContexts,
  pollAgentRun,
  readAgentPreferences,
  recordAgentRun,
  recordAgentRunPendingQuestion,
  recordAgentRunRollback,
  recordAgentTaskQuestion,
  recordAgentTaskRunDetail,
  respondAgentTask,
  startAgentRun,
  undoAgentRun,
  updateAgentPreferences,
  updateTaskProgress,
  uploadAgentFiles,
  upsertProjectContext,
} from '@/features/agent'
import { resolveQuestionChoices } from '@/features/agent/question-choices'
import { getSettings } from '@/features/settings/settings-api'
import { project } from '@easy-editor/core'
import {
  ArrowUpRight,
  Check,
  Circle,
  CircleStop,
  Clock3,
  LoaderCircle,
  MessageCircleQuestion,
  MessageSquareText,
  Paperclip,
  Send,
  X,
} from 'lucide-react'
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { buildEditorAgentSelectionContext } from './agent-selection-context'

export type EditorAgentDockProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type DockAttachment = AgentAttachmentInput & { clientId: string; file?: File }

function compareConversationActivity(first: AgentConversation, second: AgentConversation): number {
  return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime()
}

function formatActivity(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function stageMarker(status: AgentTaskStageStatus) {
  if (status === 'complete') return <Check className='size-3' />
  if (status === 'running') return <LoaderCircle className='size-3 animate-spin' />
  if (status === 'waiting') return <Clock3 className='size-3' />
  return <Circle className='size-2.5' />
}

function stageTone(status: AgentTaskStageStatus): string {
  if (status === 'complete') return 'border-[var(--ed-success)]/45 text-[var(--ed-success)]'
  if (status === 'failed') return 'border-[var(--ed-error)]/45 text-[var(--ed-error)]'
  if (status === 'running') return 'border-[var(--ed-cyan)]/45 text-[var(--ed-cyan)]'
  if (status === 'waiting') return 'border-[var(--ed-warning)]/45 text-[var(--ed-warning)]'
  return 'border-[var(--ed-line)] text-[var(--ed-ink-faint)]'
}

function taskStatusDescription(status: AgentTaskStatus): string {
  if (status === 'complete') return '本次修改已完成'
  if (status === 'failed') return '任务未完成，请重试当前阶段'
  if (status === 'paused') return '任务已暂停，可以继续处理'
  if (status === 'canceled') return '任务已取消'
  return 'Agent 正在继续处理这个任务'
}

function taskActivitySummary(task: AgentConversation['tasks'][number]): string {
  const activity = [...(task.activities ?? [])].sort((left, right) => left.seq - right.seq).at(-1)
  if (task.status === 'complete') return '画布已更新并完成检查'
  if (task.status === 'failed') return activity?.summary ?? '本轮没有完成，可以重试当前阶段'
  if (task.status === 'canceled') return '本轮已停止，已完成的修改仍可撤销'
  if (task.status === 'paused') return '本轮已暂停，处理后可以继续'
  if (activity?.type === 'change_committed') return '修改已同步到当前画布，正在检查结果'
  if (activity?.type === 'step_passed') return '当前步骤检查通过，正在继续后续工作'
  return activity?.summary ?? taskStatusDescription(task.status)
}

function planningErrorMessage(reason: unknown): string {
  if (reason instanceof ApiError) {
    if (reason.code === 'AGENT_MODEL_UNAVAILABLE') {
      return 'Agent 模型尚未配置，任务、附件清单和输入已保留。'
    }
    if (reason.code === 'AGENT_RATE_LIMITED') return '规划请求过于频繁，请稍后重试当前阶段。'
    if (reason.code === 'AGENT_PLAN_IN_PROGRESS') return '已有规划请求正在运行，请等待完成后重试。'
    if (reason.code === 'AGENT_PLAN_IDEMPOTENCY_CONFLICT') return '当前任务输入已变化，请创建一条新任务。'
  }
  if (reason instanceof Error) return reason.message
  return '规划服务暂时不可用，任务和输入已保留。'
}

export function EditorAgentDock({ open, onOpenChange }: EditorAgentDockProps) {
  const { projectId, projectName, flush, reloadServerDraft } = useEditorSession()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [agentPreferences, setAgentPreferences] = useState<AgentPreferences>(DEFAULT_AGENT_PREFERENCES)
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<DockAttachment[]>([])
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [contextRetryPending, setContextRetryPending] = useState(false)
  const [workspaceRecoveryWarning, setWorkspaceRecoveryWarning] = useState(false)
  const [workspaceSyncStatus, setWorkspaceSyncStatus] = useState<
    'hydrating' | 'synced' | 'saving' | 'offline' | 'error'
  >('hydrating')
  const [rollbackPendingOperationId, setRollbackPendingOperationId] = useState<string | null>(null)
  const [cancelPendingTaskId, setCancelPendingTaskId] = useState<string | null>(null)
  const [rolledBackOperationIds, setRolledBackOperationIds] = useState<Set<string>>(() => new Set())
  const planningRef = useRef(false)
  const activeOperationIdsRef = useRef(new Set<string>())
  const refreshedOperationIdsRef = useRef(new Set<string>())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const requestedConversationId = searchParams.get('conversation')

  const refreshConversations = useCallback(() => {
    if (!user) {
      setConversations([])
      setAgentPreferences(DEFAULT_AGENT_PREFERENCES)
      setWorkspaceRecoveryWarning(false)
      return
    }
    const nextConversations = getProjectConversations(user.id, projectId).sort(compareConversationActivity)
    setConversations(nextConversations)
    setAgentPreferences(readAgentPreferences(user.id))
    setRolledBackOperationIds(
      new Set(
        nextConversations.flatMap(conversation =>
          conversation.tasks.flatMap(task => (task.run?.rolledBackAt ? [task.run.operationId] : [])),
        ),
      ),
    )
    setWorkspaceRecoveryWarning(hasAgentWorkspaceRecovery(user.id))
  }, [projectId, user])

  useEffect(() => {
    refreshConversations()
  }, [refreshConversations])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    void getSettings()
      .then(settings => {
        if (cancelled || !settings.agentPreferences) return
        updateAgentPreferences(user.id, settings.agentPreferences)
        refreshConversations()
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [refreshConversations, user])

  useEffect(() => {
    if (!user) return
    return connectAgentWorkspaceSync({
      ownerUserId: user.id,
      projectId,
      onStatus: setWorkspaceSyncStatus,
      onWorkspace: () => refreshConversations(),
    })
  }, [projectId, refreshConversations, user])

  useEffect(() => {
    const handleStorage = () => refreshConversations()
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [refreshConversations])

  const currentConversation = useMemo(
    () => conversations.find(conversation => conversation.id === requestedConversationId) ?? conversations[0] ?? null,
    [conversations, requestedConversationId],
  )

  useEffect(() => {
    if (!open || !currentConversation) return
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [currentConversation, open])

  const selectConversation = (conversationId: string) => {
    setPlanError(null)
    setContextError(null)
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('conversation', conversationId)
    setSearchParams(nextSearchParams, { replace: true })
  }

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    setAttachments(current => [
      ...current,
      ...files.map(file => ({
        clientId: crypto.randomUUID(),
        file,
        name: file.name,
        mimeType: file.type || undefined,
        size: file.size,
        scope: agentPreferences.defaultAttachmentScope,
      })),
    ])
    event.target.value = ''
  }

  const createContextProposal = useCallback(
    (prompt: string, plan: string, taskId: string) => {
      if (!user || !agentPreferences.rememberProjectContext) return
      const proposal = buildProjectMemoryProposal({ sourceTaskId: taskId, userGoal: prompt, agentSummary: plan })
      if (!proposal) return
      const pending = getProjectContexts(user.id, projectId).find(
        context => context.status === 'pending' && context.title === '本轮需求摘要',
      )
      upsertProjectContext({
        ownerUserId: user.id,
        projectId,
        contextId: pending?.id,
        ...proposal,
        status: 'pending',
      })
    },
    [agentPreferences.rememberProjectContext, projectId, user],
  )

  const executePlan = useCallback(
    async (
      conversation: AgentConversation,
      prompt: string,
      submittedAttachments: AgentAttachmentInput[],
      taskId: string,
      clarification?: { questionId: string; turnId: string },
    ) => {
      if (!user || planningRef.current) return
      planningRef.current = true
      setPlanning(true)
      setPlanError(null)
      setContextError(null)

      try {
        try {
          updateTaskProgress({
            ownerUserId: user.id,
            conversationId: conversation.id,
            taskId,
            taskStatus: 'running',
            stageId: 'plan-layout',
            stageStatus: 'running',
          })
          refreshConversations()
        } catch {
          setPlanError('无法更新本地任务状态，规划请求尚未发出。请重试当前阶段。')
          return
        }

        let run: Awaited<ReturnType<typeof startAgentRun>>
        try {
          const confirmedContextsPromise = listSharedProjectContexts(projectId)
          await flush()
          const confirmedContexts = await confirmedContextsPromise
          const requestAttachments = [
            ...getProjectAttachmentManifest(user.id, projectId),
            ...submittedAttachments.filter(attachment => attachment.scope === 'conversation'),
          ]
          if (clarification) {
            const response = await respondAgentTask({
              projectId,
              conversationId: conversation.id,
              taskId,
              questionId: clarification.questionId,
              turnId: clarification.turnId,
              response: prompt,
              attachmentIds: requestAttachments.flatMap(attachment => (attachment.id ? [attachment.id] : [])),
              selectionContext: buildEditorAgentSelectionContext(project),
            })
            if (response.kind === 'waiting_user') {
              recordAgentTaskQuestion({
                ownerUserId: user.id,
                conversationId: conversation.id,
                taskId,
                questionId: response.question.id,
                message: response.message,
                prompt: response.question.text,
                plan: response.plan,
                usage: response.usage,
              })
              return
            }
            run = response.run
          } else {
            run = await startAgentRun({
              projectId,
              conversationId: conversation.id,
              taskId,
              prompt,
              attachments: requestAttachments,
              projectContext: confirmedContexts.map(context => ({
                title: context.title,
                content: context.content,
                status: context.status,
              })),
              selectionContext: buildEditorAgentSelectionContext(project),
            })
          }
          recordAgentRun({
            ownerUserId: user.id,
            conversationId: conversation.id,
            taskId,
            operationId: run.operationId,
            status: run.status,
            outcome: run.outcome,
            receipt: run.receipt,
            cost: run.cost,
            trace: run.trace,
            rollback: run.rollback,
            rolledBackAt: run.rolledBackAt,
            rollbackReceipt: run.rollbackReceipt,
            message: run.message,
            usage: run.usage,
          })
          recordAgentRunPendingQuestion({
            ownerUserId: user.id,
            conversationId: conversation.id,
            taskId,
            run,
          })
          run = await pollAgentRun(projectId, run)
          recordAgentRun({
            ownerUserId: user.id,
            conversationId: conversation.id,
            taskId,
            operationId: run.operationId,
            status: run.status,
            outcome: run.outcome,
            receipt: run.receipt,
            cost: run.cost,
            trace: run.trace,
            rollback: run.rollback,
            rolledBackAt: run.rolledBackAt,
            rollbackReceipt: run.rollbackReceipt,
            message: run.message,
            usage: run.usage,
          })
          recordAgentRunPendingQuestion({
            ownerUserId: user.id,
            conversationId: conversation.id,
            taskId,
            run,
          })
        } catch (reason) {
          const detail = planningErrorMessage(reason)
          setPlanError(detail)
          try {
            updateTaskProgress({
              ownerUserId: user.id,
              conversationId: conversation.id,
              taskId,
              taskStatus: 'waiting',
              stageId: 'plan-layout',
              stageStatus: 'waiting',
              detail: `规划请求失败：${detail}`,
            })
          } catch {
            setPlanError(`${detail} 本地任务状态也未能保存。`)
          }
          return
        }

        if (run.status === 'committed') {
          createContextProposal(prompt, run.message ?? '', taskId)
          try {
            await reloadServerDraft()
          } catch (reason) {
            setPlanError(
              reason instanceof Error
                ? `执行已提交，但编辑器刷新失败：${reason.message}`
                : '执行已提交，但编辑器刷新失败，请手动刷新页面。',
            )
          }
        }
      } finally {
        planningRef.current = false
        setPlanning(false)
        refreshConversations()
      }
    },
    [createContextProposal, flush, projectId, refreshConversations, reloadServerDraft, user],
  )

  const resumeAgentRun = useCallback(
    async (conversation: AgentConversation, task: AgentConversation['tasks'][number]) => {
      if (!user || !task.run || planningRef.current) return
      const { operationId } = task.run
      if (activeOperationIdsRef.current.has(operationId)) return
      activeOperationIdsRef.current.add(operationId)
      planningRef.current = true
      setPlanning(true)
      setPlanError(null)
      try {
        const run = await pollAgentRun(projectId, {
          operationId,
          taskId: task.id,
          status: task.run.status,
          outcome: task.run.outcome,
          receipt: task.run.receipt,
          cost: task.run.cost,
          trace: task.run.trace,
          rollback: task.run.rollback,
          rolledBackAt: task.run.rolledBackAt,
          rollbackReceipt: task.run.rollbackReceipt,
          usage: task.usage,
        })
        recordAgentRun({
          ownerUserId: user.id,
          conversationId: conversation.id,
          taskId: task.id,
          operationId: run.operationId,
          status: run.status,
          outcome: run.outcome,
          receipt: run.receipt,
          cost: run.cost,
          trace: run.trace,
          rollback: run.rollback,
          rolledBackAt: run.rolledBackAt,
          rollbackReceipt: run.rollbackReceipt,
          message: run.message,
          usage: run.usage,
        })
        recordAgentRunPendingQuestion({
          ownerUserId: user.id,
          conversationId: conversation.id,
          taskId: task.id,
          run,
        })
        if (run.status === 'committed') {
          await reloadServerDraft()
          const userMessage = getTaskUserMessage(conversation, task.id)
          const assistantMessage = conversation.messages.find(
            item => item.role === 'assistant' && item.taskId === task.id,
          )
          createContextProposal(
            userMessage?.content || '请结合附件继续规划这个项目',
            run.message ?? assistantMessage?.content ?? '',
            task.id,
          )
        }
      } catch (reason) {
        setPlanError(`恢复任务轮询失败：${planningErrorMessage(reason)}；不会重复启动任务。`)
      } finally {
        activeOperationIdsRef.current.delete(operationId)
        planningRef.current = false
        setPlanning(false)
        refreshConversations()
      }
    },
    [createContextProposal, projectId, refreshConversations, reloadServerDraft, user],
  )

  useEffect(() => {
    if (planning) return
    const resumable = conversations
      .flatMap(conversation => conversation.tasks.map(task => ({ conversation, task })))
      .reverse()
      .find(({ task }) => task.run && ['planning', 'running', 'prepared'].includes(task.run.status))
    if (resumable) void resumeAgentRun(resumable.conversation, resumable.task)
  }, [conversations, planning, resumeAgentRun])

  useEffect(() => {
    if (!user) return
    const task = [...(currentConversation?.tasks ?? [])]
      .reverse()
      .find(
        candidate => candidate.run && ['committed', 'stale', 'failed', 'indeterminate'].includes(candidate.run.status),
      )
    const candidate = task && currentConversation ? { conversation: currentConversation, task } : null
    if (!candidate?.task.run || refreshedOperationIdsRef.current.has(candidate.task.run.operationId)) return
    const operationId = candidate.task.run.operationId
    refreshedOperationIdsRef.current.add(operationId)
    void getAgentRun(projectId, operationId)
      .then(run => {
        recordAgentRun({
          ownerUserId: user.id,
          conversationId: candidate.conversation.id,
          taskId: candidate.task.id,
          operationId: run.operationId,
          status: run.status,
          outcome: run.outcome,
          receipt: run.receipt,
          cost: run.cost,
          trace: run.trace,
          rollback: run.rollback,
          rolledBackAt: run.rolledBackAt,
          rollbackReceipt: run.rollbackReceipt,
          usage: run.usage,
        })
        recordAgentRunPendingQuestion({
          ownerUserId: user.id,
          conversationId: candidate.conversation.id,
          taskId: candidate.task.id,
          run,
        })
        refreshConversations()
      })
      .catch(() => refreshedOperationIdsRef.current.delete(operationId))
  }, [currentConversation, projectId, refreshConversations, user])

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user || planningRef.current) return

    const content = message.trim()
    if (!content && attachments.length === 0) return
    const submittedAttachments = attachments

    const targetConversation =
      currentConversation ??
      createAgentConversation({
        ownerUserId: user.id,
        projectId,
        projectName,
        title: content.slice(0, 40) || `${projectName} 资料`,
      })
    const latestTask = targetConversation.tasks.at(-1)
    const pendingQuestion = latestTask?.status === 'waiting_user' ? latestTask.pendingQuestion : undefined
    let uploadedAttachments: AgentAttachmentInput[]
    try {
      uploadedAttachments = submittedAttachments.some(attachment => attachment.file)
        ? await uploadAgentFiles(
            projectId,
            targetConversation.id,
            submittedAttachments.flatMap(attachment =>
              attachment.file
                ? [{ file: attachment.file, scope: attachment.scope, idempotencyKey: attachment.clientId }]
                : [],
            ),
          )
        : submittedAttachments.map(({ clientId: _clientId, file: _file, ...attachment }) => attachment)
    } catch (reason) {
      setPlanError(reason instanceof Error ? reason.message : '附件上传失败，消息未发送。')
      return
    }

    const conversation =
      targetConversation.messages.length > 0
        ? appendAgentTurn({
            ownerUserId: user.id,
            conversationId: targetConversation.id,
            content,
            attachments: uploadedAttachments,
          })
        : appendAgentTurn({
            ownerUserId: user.id,
            conversationId: targetConversation.id,
            content,
            attachments: uploadedAttachments,
          })

    const task = conversation.tasks.at(-1)
    const userTurn = conversation.messages.at(-1)
    setMessage('')
    setAttachments([])
    setPlanError(null)
    setContextError(null)
    selectConversation(conversation.id)
    if (!task) {
      refreshConversations()
      return
    }

    await executePlan(
      conversation,
      content || '请结合附件继续规划这个项目',
      uploadedAttachments,
      task.id,
      pendingQuestion && userTurn?.role === 'user'
        ? { questionId: pendingQuestion.id, turnId: userTurn.id }
        : undefined,
    )
  }

  const retryCurrentPlan = useCallback(async () => {
    const task = currentConversation?.tasks.at(-1)
    if (!user || !currentConversation || !task) return
    const userMessage = getTaskUserMessage(currentConversation, task.id)
    if (!userMessage) {
      setPlanError('找不到当前任务的原始输入，请发送一条新消息。')
      return
    }
    const retryConversation = appendAgentTurn({
      ownerUserId: user.id,
      conversationId: currentConversation.id,
      content: userMessage.content,
      attachments: userMessage.attachments,
    })
    const retryTask = retryConversation.tasks.at(-1)
    if (!retryTask) {
      setPlanError('无法创建新的重试任务，请重新发送一条消息。')
      return
    }
    refreshConversations()
    await executePlan(
      retryConversation,
      userMessage.content || '请结合附件继续规划这个项目',
      userMessage.attachments,
      retryTask.id,
    )
  }, [currentConversation, executePlan, refreshConversations, user])

  const retryContextProposal = useCallback(async () => {
    const task = currentConversation?.tasks.at(-1)
    if (!currentConversation || !task) return
    const userMessage = getTaskUserMessage(currentConversation, task.id)
    const assistantMessage = currentConversation.messages.find(
      item => item.role === 'assistant' && item.taskId === task.id,
    )
    if (!userMessage || !assistantMessage) {
      setContextError('找不到本轮蓝图，无法重新整理项目上下文。')
      return
    }

    setContextRetryPending(true)
    try {
      createContextProposal(userMessage.content || '请结合附件继续规划这个项目', assistantMessage.content, task.id)
      setContextError(null)
      refreshConversations()
    } catch {
      setContextError('项目上下文仍未保存，请稍后重试或手动补充。')
    } finally {
      setContextRetryPending(false)
    }
  }, [createContextProposal, currentConversation, refreshConversations])

  const rollbackRun = useCallback(
    async (operationId: string) => {
      setRollbackPendingOperationId(operationId)
      setPlanError(null)
      try {
        const undo = await undoAgentRun(projectId, operationId)
        await reloadServerDraft()
        const ownerConversation = conversations.find(conversation =>
          conversation.tasks.some(task => task.run?.operationId === operationId),
        )
        if (ownerConversation && user) {
          recordAgentRunRollback({
            ownerUserId: user.id,
            conversationId: ownerConversation.id,
            operationId,
            receipt: undo.receipt,
            updatedAt: undo.rolledBackAt,
          })
          refreshConversations()
        }
        setRolledBackOperationIds(current => new Set(current).add(operationId))
      } catch (reason) {
        setPlanError(reason instanceof Error ? reason.message : '回滚失败，请稍后重试。')
      } finally {
        setRollbackPendingOperationId(null)
      }
    },
    [conversations, projectId, refreshConversations, reloadServerDraft, user],
  )

  const cancelTask = useCallback(
    async (task: AgentConversation['tasks'][number]) => {
      if (!user) return
      setCancelPendingTaskId(task.id)
      setPlanError(null)
      try {
        if (task.taskRunId) {
          const detail = await cancelAgentTaskRun(projectId, task.taskRunId)
          recordAgentTaskRunDetail({
            ownerUserId: user.id,
            conversationId: currentConversation!.id,
            detail,
          })
        } else if (task.run) {
          const run = await controlAgentRun(projectId, task.run.operationId, 'cancel')
          recordAgentRun({
            ownerUserId: user.id,
            conversationId: currentConversation!.id,
            taskId: task.id,
            operationId: run.operationId,
            status: run.status,
            outcome: run.outcome,
            receipt: run.receipt,
            cost: run.cost,
            trace: run.trace,
            rollback: run.rollback,
            rolledBackAt: run.rolledBackAt,
            rollbackReceipt: run.rollbackReceipt,
            message: run.message,
            usage: run.usage,
          })
        }
        refreshConversations()
      } catch (reason) {
        setPlanError(`停止任务失败：${planningErrorMessage(reason)}`)
      } finally {
        setCancelPendingTaskId(null)
      }
    },
    [currentConversation, projectId, refreshConversations, user],
  )

  if (!open) return null

  const latestTask = currentConversation?.tasks.at(-1)
  const pendingQuestion = latestTask?.status === 'waiting_user' ? latestTask.pendingQuestion : undefined
  const questionChoices = pendingQuestion ? resolveQuestionChoices(pendingQuestion.prompt) : []
  const currentStage = latestTask
    ? (latestTask.stages.find(stage => stage.status === 'failed') ??
      latestTask.stages.find(stage => stage.status === 'running') ??
      latestTask.stages.find(stage => stage.status === 'waiting') ??
      latestTask.stages.at(-1))
    : undefined
  const planningStage = latestTask?.stages.find(stage => stage.id === 'plan-layout')
  const failedPlanDetail =
    planningStage?.detail?.startsWith('规划请求失败：') || planningStage?.detail?.startsWith('规划结果待恢复：')
      ? planningStage.detail
      : null
  const visiblePlanError =
    planError ??
    failedPlanDetail ??
    contextError ??
    (workspaceSyncStatus === 'offline'
      ? '服务端工作区暂时不可用，当前变更仅保存在本机。'
      : workspaceSyncStatus === 'error'
        ? '工作区同步失败，请稍后重试。'
        : workspaceRecoveryWarning
          ? '检测到无法读取的旧 Agent 本地数据，原始副本已隔离保留；当前从空白 Agent 状态继续。'
          : null)
  const retryNotice = planError || failedPlanDetail ? retryCurrentPlan : contextError ? retryContextProposal : undefined
  const retryLabel = planError || failedPlanDetail ? '重试当前阶段' : contextError ? '重试保存上下文' : undefined

  return (
    <aside
      id='editor-agent-dock'
      data-editor-agent-dock
      data-ed-shell='editor'
      aria-label='项目 Agent'
      className='fixed top-[var(--ed-header-height)] right-0 bottom-0 z-40 flex w-[390px] max-w-[calc(100vw-var(--ed-tool-rail-width))] flex-col border-l border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-[var(--ed-ink)] shadow-[-18px_0_36px_rgba(0,0,0,0.28)]'
    >
      <header className='flex h-[var(--ed-panel-header-height)] shrink-0 items-center justify-between border-b border-[var(--ed-line)] bg-[var(--ed-rail)] px-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <MessageSquareText className='size-3.5 text-[var(--ed-cyan)]' />
          <div className='min-w-0'>
            <h2 className='truncate text-xs font-semibold'>EasyDashboard Agent</h2>
            <p className='truncate text-[11px] text-[var(--ed-ink-faint)]'>{projectName}</p>
          </div>
        </div>
        <button
          type='button'
          aria-label='关闭项目 Agent'
          onClick={() => onOpenChange(false)}
          className='grid size-[var(--ed-control-compact)] place-items-center rounded-[5px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ed-cyan)]'
        >
          <X className='size-4' />
        </button>
      </header>

      <div className='shrink-0 border-b border-[var(--ed-line)] px-3 py-2.5'>
        <div className='flex items-center justify-between gap-3'>
          <p className='text-xs font-medium text-[var(--ed-ink-muted)]'>最近对话</p>
          {currentConversation ? (
            <Link
              to={`/projects/${projectId}/agent/${currentConversation.id}`}
              className='inline-flex items-center gap-1 text-xs text-[var(--ed-cyan)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ed-cyan)]'
            >
              完整工作区
              <ArrowUpRight className='size-3' />
            </Link>
          ) : null}
        </div>
        {conversations.length > 0 ? (
          <div className='mt-2 flex gap-1.5 overflow-x-auto pb-0.5'>
            {conversations.slice(0, 5).map(conversation => {
              const selected = conversation.id === currentConversation?.id
              return (
                <button
                  key={conversation.id}
                  type='button'
                  aria-pressed={selected}
                  onClick={() => selectConversation(conversation.id)}
                  className={`max-w-36 shrink-0 truncate rounded-[5px] border px-2 py-1 text-[10px] ${
                    selected
                      ? 'border-[var(--ed-cyan)]/55 bg-[var(--ed-panel-raised)] text-[var(--ed-ink)]'
                      : 'border-[var(--ed-line)] text-[var(--ed-ink-muted)] hover:border-[var(--ed-line-strong)] hover:text-[var(--ed-ink-soft)]'
                  }`}
                >
                  {conversation.title}
                </button>
              )
            })}
          </div>
        ) : (
          <p className='mt-2 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
            发送第一条消息，创建这个项目的私有对话。
          </p>
        )}
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-3 py-3'>
        {currentConversation ? (
          <div className='space-y-3'>
            {currentConversation.messages
              .filter(item => item.role !== 'system')
              .map(item => (
                <article
                  key={item.id}
                  className={`border px-3 py-2.5 ${
                    item.role === 'user'
                      ? 'ml-7 border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)]'
                      : 'mr-4 border-[var(--ed-line)] bg-[var(--ed-rail)]'
                  }`}
                >
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-[10px] font-medium text-[var(--ed-ink-muted)]'>
                      {item.role === 'user' ? '你' : 'EasyDashboard Agent'}
                    </span>
                    <time className='text-[11px] text-[var(--ed-ink-faint)]' dateTime={item.createdAt}>
                      {formatActivity(item.createdAt)}
                    </time>
                  </div>
                  {item.content ? (
                    <p className='mt-1.5 whitespace-pre-wrap text-xs leading-5 text-[var(--ed-ink-soft)]'>
                      {item.content}
                    </p>
                  ) : null}
                  {item.attachments.length > 0 ? (
                    <ul className='mt-2 space-y-1 border-t border-[var(--ed-line)] pt-2'>
                      {item.attachments.map(attachment => (
                        <li key={attachment.id} className='flex min-w-0 items-center gap-1.5 text-[10px]'>
                          <Paperclip className='size-3 shrink-0 text-[var(--ed-ink-faint)]' />
                          <span className='truncate text-[var(--ed-ink-muted)]'>{attachment.name}</span>
                          <span className='ml-auto shrink-0 text-[var(--ed-ink-faint)]'>
                            {attachment.scope === 'project' ? '项目文件清单' : '仅本对话'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}

            {latestTask && latestTask.status !== 'waiting_user' && agentPreferences.showTaskProgress ? (
              <section
                aria-label='当前任务状态'
                aria-live='polite'
                className='border border-[var(--ed-line-strong)] bg-[var(--ed-rail)] px-3 py-3'
              >
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <p className='text-[11px] text-[var(--ed-cyan)]'>{taskStatusDescription(latestTask.status)}</p>
                    <h3 className='mt-0.5 truncate text-xs font-medium text-[var(--ed-ink-soft)]'>
                      {latestTask.title}
                    </h3>
                  </div>
                  <span className='shrink-0 text-[11px] text-[var(--ed-ink-muted)]'>
                    {formatActivity(latestTask.updatedAt)}
                  </span>
                </div>
                {currentStage ? (
                  <div className='mt-2.5 flex items-start gap-2'>
                    <span
                      className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${stageTone(currentStage.status)}`}
                    >
                      {stageMarker(currentStage.status)}
                    </span>
                    <div className='min-w-0 pt-0.5'>
                      <p className='text-[11px] text-[var(--ed-ink-muted)]'>{currentStage.title}</p>
                      <p className='mt-0.5 text-[11px] leading-4 text-[var(--ed-ink-faint)]'>
                        {taskStatusDescription(latestTask.status)}
                      </p>
                    </div>
                  </div>
                ) : null}
                <p className='mt-2 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
                  {taskActivitySummary(latestTask)}
                </p>
                <div className='mt-2 flex items-center gap-3 border-t border-[var(--ed-line)] pt-2'>
                  <Link
                    to={`/projects/${projectId}/agent/${currentConversation.id}`}
                    className='text-[11px] text-[var(--ed-cyan)] hover:text-[var(--ed-ink)]'
                  >
                    查看本轮过程
                  </Link>
                  {['waiting', 'running', 'paused'].includes(latestTask.status) ? (
                    <button
                      type='button'
                      disabled={cancelPendingTaskId === latestTask.id}
                      onClick={() => void cancelTask(latestTask)}
                      className='ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-[5px] px-2 text-[11px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-error)] disabled:opacity-50'
                    >
                      <CircleStop className='size-3.5' aria-hidden='true' />
                      {cancelPendingTaskId === latestTask.id ? '停止中' : '停止本轮'}
                    </button>
                  ) : null}
                </div>
                {latestTask.run?.rollback ? (
                  <div className='mt-2 border-t border-[var(--ed-line)] pt-2 text-[11px]'>
                    <button
                      type='button'
                      disabled={
                        rollbackPendingOperationId === latestTask.run.operationId ||
                        rolledBackOperationIds.has(latestTask.run.operationId)
                      }
                      onClick={() => void rollbackRun(latestTask.run!.operationId)}
                      className='mt-1 text-[var(--ed-cyan)] hover:text-[var(--ed-ink)] disabled:opacity-50'
                    >
                      {rolledBackOperationIds.has(latestTask.run.operationId)
                        ? '已回滚'
                        : rollbackPendingOperationId === latestTask.run.operationId
                          ? '回滚中…'
                          : '撤销本次修改'}
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className='mx-auto flex h-full min-h-40 max-w-[280px] flex-col items-center justify-center px-4 text-center'>
            <span className='grid size-8 place-items-center rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel-raised)]'>
              <MessageSquareText className='size-4 text-[var(--ed-cyan)]' />
            </span>
            <p className='mt-3 text-xs font-medium text-[var(--ed-ink-soft)]'>继续编辑当前大屏</p>
            <p className='mt-1.5 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
              描述要调整的内容，Agent 会结合当前画布继续处理。
            </p>
          </div>
        )}
      </div>

      <form
        onSubmit={submitMessage}
        className='relative shrink-0 border-t border-[var(--ed-line)] bg-[var(--ed-rail)] p-3'
      >
        {pendingQuestion ? (
          <section
            data-agent-question='editor-dock'
            aria-label='Agent 等待你的选择'
            className='absolute bottom-[calc(100%+10px)] left-3 right-3 z-30 rounded-[9px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] p-3 shadow-[0_14px_36px_rgba(0,0,0,0.32)]'
          >
            <div className='flex items-start gap-2.5'>
              <MessageCircleQuestion className='mt-0.5 size-4 shrink-0 text-[var(--ed-cyan)]' aria-hidden='true' />
              <div className='min-w-0 flex-1'>
                <p className='text-[11px] font-medium text-[var(--ed-cyan)]'>需要你的选择</p>
                <p className='mt-1 text-xs leading-5 text-[var(--ed-ink-soft)]'>{pendingQuestion.prompt}</p>
              </div>
            </div>
            <div className='mt-3 grid gap-1.5'>
              {questionChoices.map(choice => {
                const selected = message.trim() === choice
                return (
                  <button
                    key={choice}
                    type='button'
                    aria-pressed={selected}
                    onClick={() => {
                      setMessage(choice === '我需要补充说明' ? '' : choice)
                      messageInputRef.current?.focus()
                    }}
                    className={`min-h-10 rounded-[6px] border px-3 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ed-cyan)] ${
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
            <div className='mt-2 flex items-center justify-between gap-3'>
              <p className='text-[11px] text-[var(--ed-ink-faint)]'>也可以在下方输入自己的回答</p>
              {latestTask ? (
                <button
                  type='button'
                  disabled={cancelPendingTaskId === latestTask.id}
                  onClick={() => void cancelTask(latestTask)}
                  className='min-h-8 shrink-0 rounded-[5px] px-2 text-[11px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel)] hover:text-[var(--ed-error)] disabled:opacity-50'
                >
                  {cancelPendingTaskId === latestTask.id ? '停止中' : '停止本轮'}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
        {visiblePlanError ? (
          <div
            role='alert'
            className='mb-2 flex items-start gap-2 border-l-2 border-[var(--ed-error)] px-2 text-[10px] leading-4 text-[var(--ed-error)]'
          >
            <p className='min-w-0 flex-1'>{visiblePlanError}</p>
            {retryNotice && retryLabel ? (
              <button
                type='button'
                disabled={planning || contextRetryPending}
                onClick={() => void retryNotice()}
                className='shrink-0 rounded-[5px] border border-[var(--ed-error)]/35 px-2 py-1 text-[9px] hover:bg-[var(--ed-error)]/10 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {retryLabel}
              </button>
            ) : null}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <ul className='mb-2 space-y-1'>
            {attachments.map((attachment, index) => (
              <li
                key={`${attachment.name}-${index}`}
                className='flex items-center gap-2 border border-[var(--ed-line)] bg-[var(--ed-panel)] px-2 py-1.5'
              >
                <Paperclip className='size-3 shrink-0 text-[var(--ed-cyan)]' />
                <span className='min-w-0 flex-1 truncate text-[10px] text-[var(--ed-ink-muted)]'>
                  {attachment.name}
                </span>
                <span className='text-[9px] text-[var(--ed-ink-faint)]'>
                  {attachment.scope === 'project' ? '项目文件清单' : '仅本对话'}
                </span>
                <button
                  type='button'
                  aria-label={`移除附件 ${attachment.name}`}
                  onClick={() => setAttachments(current => current.filter((_, itemIndex) => itemIndex !== index))}
                  className='text-[var(--ed-ink-faint)] hover:text-[var(--ed-error)]'
                >
                  <X className='size-3' />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={messageInputRef}
          value={message}
          onChange={event => setMessage(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          disabled={planning}
          placeholder='说明要继续完成的工作…'
          rows={3}
          className='w-full resize-none rounded-[5px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-3 py-2 text-[12px] leading-5 text-[var(--ed-ink)] outline-none placeholder:text-[var(--ed-ink-faint)] focus:border-[var(--ed-cyan)]'
        />
        <div className='mt-2 flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <input
              ref={fileInputRef}
              type='file'
              multiple
              accept={AGENT_ATTACHMENT_ACCEPT}
              className='sr-only'
              onChange={handleFiles}
            />
            <button
              type='button'
              title={`支持 ${AGENT_ATTACHMENT_FORMAT_LABEL}`}
              onClick={() => fileInputRef.current?.click()}
              className='inline-flex h-9 items-center gap-1.5 rounded-[5px] px-2.5 text-[11px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ed-cyan)]'
            >
              <Paperclip className='size-3.5' />
              添加附件
            </button>
            <span className='text-[9px] text-[var(--ed-ink-faint)]'>
              {agentPreferences.defaultAttachmentScope === 'project' ? '默认加入项目清单' : '默认仅本对话'}
            </span>
          </div>
          <button
            type='submit'
            disabled={!user || planning || (!message.trim() && attachments.length === 0)}
            className='inline-flex h-9 items-center gap-1.5 rounded-[5px] bg-[var(--ed-ink)] px-3 text-[11px] font-medium text-[var(--ed-canvas)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40'
          >
            {planning ? <LoaderCircle className='size-3.5 animate-spin' /> : <Send className='size-3.5' />}
            {planning ? '规划中' : '发送'}
          </button>
        </div>
      </form>
    </aside>
  )
}
