import { ApiError } from '@/api/client'
import type { ProjectDetail } from '@/api/contracts'
import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/button'
import {
  type AgentAttachmentInput,
  type AgentConversation,
  type AgentFileSelection,
  type AgentPreferences,
  type AgentProjectContext,
  DEFAULT_AGENT_PREFERENCES,
  appendAgentTurn,
  buildProjectMemoryProposal,
  connectAgentWorkspaceSync,
  createAgentConversation,
  deleteProjectContext,
  deleteSharedProjectContext,
  getAgentRun,
  getProjectAttachmentManifest,
  getProjectConversations,
  getTaskUserMessage,
  hasAgentWorkspaceRecovery,
  isSharedProjectContextConflict,
  listSharedProjectContexts,
  pollAgentRun,
  readAgentPreferences,
  readAgentWorkspace,
  recordAgentRun,
  recordAgentRunPendingQuestion,
  recordAgentRunRollback,
  recordAgentTaskQuestion,
  respondAgentTask,
  rollbackProjectContext,
  rollbackSharedProjectContext,
  saveSharedProjectContext,
  startAgentRun,
  undoAgentRun,
  updateAgentPreferences,
  updateTaskProgress,
  uploadAgentFiles,
  upsertProjectContext,
} from '@/features/agent'
import { getProject } from '@/features/projects/project-api'
import { publishProjectDraftUpdate } from '@/features/projects/project-draft-channel'
import { getSettings } from '@/features/settings/settings-api'
import { createDataSourceEngine } from '@easy-editor/plugin-datasource'
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  CircleAlert,
  LayoutDashboard,
  LoaderCircle,
  MessageSquareText,
  PencilRuler,
  RotateCw,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { type PreviewDataSourceEngine, ProjectSchemaRenderer } from '../preview/ProjectSchemaRenderer'
import { ConversationThread } from './ConversationThread'
import { ProjectContextSheet } from './ProjectContextSheet'
import { resolveActiveConversation } from './project-agent-model'
import { refreshProjectDraftAfterMutation } from './project-draft-refresh'

type LoadedProject = ProjectDetail<unknown>

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

function contextMutationErrorMessage(reason: unknown): string {
  if (isSharedProjectContextConflict(reason)) return '共享上下文已被其他协作者更新，已刷新，请重新提交本次修改。'
  if (reason instanceof Error) return reason.message
  return '共享项目上下文操作失败，内容仍保留在当前页面，请重试。'
}

export function ProjectAgentPage() {
  const { projectId, conversationId } = useParams<{ projectId: string; conversationId?: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const [project, setProject] = useState<LoadedProject | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [projectAttempt, setProjectAttempt] = useState(0)
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [activeConversation, setActiveConversation] = useState<AgentConversation | null>(null)
  const [pendingContexts, setPendingContexts] = useState<AgentProjectContext[]>([])
  const [sharedContexts, setSharedContexts] = useState<AgentProjectContext[]>([])
  const [agentPreferences, setAgentPreferences] = useState<AgentPreferences>(DEFAULT_AGENT_PREFERENCES)
  const [contextOpen, setContextOpen] = useState(false)
  const [planPending, setPlanPending] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [draftRefreshError, setDraftRefreshError] = useState<string | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [contextRetryMode, setContextRetryMode] = useState<'proposal' | 'shared' | null>(null)
  const [contextRetryPending, setContextRetryPending] = useState(false)
  const [workspaceRecoveryWarning, setWorkspaceRecoveryWarning] = useState(false)
  const [workspaceSyncStatus, setWorkspaceSyncStatus] = useState<
    'hydrating' | 'synced' | 'saving' | 'offline' | 'error'
  >('hydrating')
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [rollbackPendingOperationId, setRollbackPendingOperationId] = useState<string | null>(null)
  const [rolledBackOperationIds, setRolledBackOperationIds] = useState<Set<string>>(() => new Set())
  const planningRef = useRef(false)
  const activeOperationIdsRef = useRef(new Set<string>())
  const refreshedOperationIdsRef = useRef(new Set<string>())
  const autoPlanKeyRef = useRef<string | null>(null)
  const routeConversationIdRef = useRef<string | null>(conversationId ?? null)
  routeConversationIdRef.current = conversationId ?? null
  const contexts = useMemo(
    () =>
      [...pendingContexts, ...sharedContexts].sort((first, second) => {
        if (first.status !== second.status) return first.status === 'pending' ? -1 : 1
        return Date.parse(second.updatedAt) - Date.parse(first.updatedAt)
      }),
    [pendingContexts, sharedContexts],
  )

  useEffect(() => {
    if (!projectId) return
    // Reading the retry counter makes each explicit retry start a fresh request.
    void projectAttempt
    let cancelled = false
    setProject(null)
    setProjectError(null)

    void getProject(projectId)
      .then(detail => {
        if (!cancelled) setProject(detail)
      })
      .catch(reason => {
        if (!cancelled) {
          setProjectError(reason instanceof Error ? reason.message : '项目加载失败')
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectAttempt, projectId])

  const refreshLocalState = useCallback(
    (preferredConversationId?: string) => {
      if (!user || !projectId) return null
      const nextConversations = getProjectConversations(user.id, projectId).sort(
        (first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt),
      )
      const nextActive = resolveActiveConversation(
        nextConversations,
        preferredConversationId ?? routeConversationIdRef.current ?? undefined,
      )
      const workspace = readAgentWorkspace(user.id)
      setWorkspaceRecoveryWarning(hasAgentWorkspaceRecovery(user.id))
      setConversations(nextConversations)
      setActiveConversation(nextActive)
      setAgentPreferences(workspace.preferences)
      setRolledBackOperationIds(
        new Set(
          nextConversations.flatMap(conversation =>
            conversation.tasks.flatMap(task => (task.run?.rolledBackAt ? [task.run.operationId] : [])),
          ),
        ),
      )
      setPendingContexts(
        workspace.projectContexts
          .filter(context => context.projectId === projectId && context.status === 'pending')
          .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt)),
      )
      return nextActive
    },
    [projectId, user],
  )

  const refreshSharedContexts = useCallback(async () => {
    if (!projectId) return []
    const next = await listSharedProjectContexts(projectId)
    setSharedContexts(next)
    return next
  }, [projectId])

  const refreshProjectDraft = useCallback(
    async (mutationLabel: '提交' | '回滚') => {
      if (!projectId) return null
      const result = await refreshProjectDraftAfterMutation({
        projectId,
        loadProject: getProject,
        applyProject: setProject,
        publishUpdate: publishProjectDraftUpdate,
      })
      if (result.ok) {
        setDraftRefreshError(null)
        return result.project
      }
      const detail = result.reason instanceof Error ? result.reason.message : '项目刷新失败'
      setDraftRefreshError(`草稿${mutationLabel}已完成，但当前画布未能刷新：${detail}。重新打开预览即可读取最新草稿。`)
      return null
    },
    [projectId],
  )

  useEffect(() => {
    if (!projectId || !user) return
    let cancelled = false
    void listSharedProjectContexts(projectId)
      .then(next => {
        if (!cancelled) setSharedContexts(next)
      })
      .catch(reason => {
        if (!cancelled) {
          setContextError(reason instanceof Error ? reason.message : '共享项目上下文加载失败，请重试。')
          setContextRetryMode('shared')
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, user])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    void getSettings()
      .then(settings => {
        if (cancelled || !settings.agentPreferences) return
        updateAgentPreferences(user.id, settings.agentPreferences)
        refreshLocalState()
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [refreshLocalState, user])

  useEffect(() => {
    if (!project || !projectId || !user || !workspaceReady) return
    let active = refreshLocalState(conversationId)
    if (!active) {
      active = createAgentConversation({
        ownerUserId: user.id,
        projectId,
        projectName: project.name,
        title: '新对话',
      })
      refreshLocalState(active.id)
    }
    if (conversationId !== active.id) {
      navigate(`/projects/${projectId}/agent/${active.id}`, { replace: true })
    }
  }, [conversationId, navigate, project, projectId, refreshLocalState, user, workspaceReady])

  useEffect(() => {
    const handleStorage = () => refreshLocalState()
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [refreshLocalState])

  useEffect(() => {
    if (!user || !projectId) return
    setWorkspaceReady(false)
    return connectAgentWorkspaceSync({
      ownerUserId: user.id,
      projectId,
      onStatus: status => {
        setWorkspaceSyncStatus(status)
        if (status !== 'hydrating' && status !== 'saving') setWorkspaceReady(true)
      },
      onWorkspace: () => refreshLocalState(),
    })
  }, [projectId, refreshLocalState, user])

  const createContextProposal = useCallback(
    (prompt: string, plan: string, taskId: string) => {
      if (!user || !projectId || !readAgentPreferences(user.id).rememberProjectContext) return
      const proposal = buildProjectMemoryProposal({ sourceTaskId: taskId, userGoal: prompt, agentSummary: plan })
      if (!proposal) return
      const pending = readAgentWorkspace(user.id).projectContexts.find(
        context => context.projectId === projectId && context.status === 'pending' && context.title === '本轮需求摘要',
      )
      upsertProjectContext({
        ownerUserId: user.id,
        projectId,
        contextId: pending?.id,
        ...proposal,
        status: 'pending',
      })
    },
    [projectId, user],
  )

  const runPlan = useCallback(
    async (
      conversation: AgentConversation,
      prompt: string,
      attachments: AgentAttachmentInput[],
      taskId: string,
      clarification?: { questionId: string; turnId: string },
    ) => {
      if (!user || !projectId || planningRef.current) return
      planningRef.current = true
      autoPlanKeyRef.current = `${conversation.id}:${taskId}`
      setPlanPending(true)
      setPlanError(null)
      setContextError(null)
      setContextRetryMode(null)

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
          refreshLocalState(conversation.id)
        } catch {
          setPlanError('无法更新本地任务状态，规划请求尚未发出。请重试当前阶段。')
          return
        }

        let run: Awaited<ReturnType<typeof startAgentRun>>
        let startedOperationId: string | null = null
        try {
          const confirmedContexts = await refreshSharedContexts()
          const requestAttachments = [
            ...getProjectAttachmentManifest(user.id, projectId),
            ...attachments.filter(attachment => attachment.scope === 'conversation'),
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
            })
          }
          startedOperationId = run.operationId
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
          activeOperationIdsRef.current.add(run.operationId)
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
          if (startedOperationId) {
            setPlanError(`任务状态查询失败：${detail}；已保留执行 ${startedOperationId}，不会重复启动。`)
            return
          }
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
          await refreshProjectDraft('提交')
          createContextProposal(prompt, run.message ?? '', taskId)
        }
      } finally {
        const operationId = readAgentWorkspace(user.id)
          .conversations.find(candidate => candidate.id === conversation.id)
          ?.tasks.find(candidate => candidate.id === taskId)?.run?.operationId
        if (operationId) activeOperationIdsRef.current.delete(operationId)
        planningRef.current = false
        setPlanPending(false)
        refreshLocalState()
      }
    },
    [createContextProposal, projectId, refreshLocalState, refreshProjectDraft, refreshSharedContexts, user],
  )

  const resumeAgentRun = useCallback(
    async (conversation: AgentConversation, task: AgentConversation['tasks'][number]) => {
      if (!user || !projectId || !task.run || planningRef.current) return
      const { operationId } = task.run
      if (activeOperationIdsRef.current.has(operationId)) return
      activeOperationIdsRef.current.add(operationId)
      planningRef.current = true
      setPlanPending(true)
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
          await refreshProjectDraft('提交')
          const message = getTaskUserMessage(conversation, task.id)
          const assistantMessage = conversation.messages.find(
            candidate => candidate.role === 'assistant' && candidate.taskId === task.id,
          )
          createContextProposal(
            message?.content || '请结合附件规划当前项目',
            run.message ?? assistantMessage?.content ?? '',
            task.id,
          )
        }
      } catch (reason) {
        setPlanError(`恢复任务轮询失败：${planningErrorMessage(reason)}；不会重复启动任务。`)
      } finally {
        activeOperationIdsRef.current.delete(operationId)
        planningRef.current = false
        setPlanPending(false)
        refreshLocalState(conversation.id)
      }
    },
    [createContextProposal, projectId, refreshLocalState, refreshProjectDraft, user],
  )

  useEffect(() => {
    if (!activeConversation || !workspaceReady || planPending) return
    const resumableTask = [...activeConversation.tasks]
      .reverse()
      .find(task => task.run && ['planning', 'running', 'prepared'].includes(task.run.status))
    if (!resumableTask) return
    void resumeAgentRun(activeConversation, resumableTask)
  }, [activeConversation, planPending, resumeAgentRun, workspaceReady])

  useEffect(() => {
    if (!activeConversation || !projectId || !user || !workspaceReady) return
    const terminalTasksMissingReplies = activeConversation.tasks.filter(task => {
      if (!task.run || !['committed', 'stale', 'failed', 'indeterminate'].includes(task.run.status)) return false
      if (refreshedOperationIdsRef.current.has(task.run.operationId)) return false
      return !activeConversation.messages.some(message => message.role === 'assistant' && message.taskId === task.id)
    })
    if (!terminalTasksMissingReplies.length) return
    for (const task of terminalTasksMissingReplies) {
      if (task.run) refreshedOperationIdsRef.current.add(task.run.operationId)
    }

    let cancelled = false
    void (async () => {
      let changed = false
      let recoveredCommittedRun = false
      for (const task of terminalTasksMissingReplies) {
        const operationId = task.run?.operationId
        if (!operationId) continue
        if (cancelled) {
          refreshedOperationIdsRef.current.delete(operationId)
          continue
        }
        try {
          const run = await getAgentRun(projectId, operationId)
          recordAgentRun({
            ownerUserId: user.id,
            conversationId: activeConversation.id,
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
            conversationId: activeConversation.id,
            taskId: task.id,
            run,
          })
          changed = true
          recoveredCommittedRun ||= run.status === 'committed'
        } catch {
          refreshedOperationIdsRef.current.delete(operationId)
        }
      }
      if (!cancelled && recoveredCommittedRun) await refreshProjectDraft('提交')
      if (!cancelled && changed) refreshLocalState(activeConversation.id)
    })()

    return () => {
      cancelled = true
    }
  }, [activeConversation, projectId, refreshLocalState, refreshProjectDraft, user, workspaceReady])

  useEffect(() => {
    if (!activeConversation || planPending) return
    const latestMessage = activeConversation.messages.at(-1)
    const latestTask = activeConversation.tasks.at(-1)
    const planStage = latestTask?.stages.find(stage => stage.id === 'plan-layout')
    if (!latestMessage || latestMessage.role !== 'user' || !latestTask || planStage?.status !== 'waiting') {
      return
    }
    const key = `${activeConversation.id}:${latestTask.id}`
    if (autoPlanKeyRef.current === key) return
    autoPlanKeyRef.current = key
    void runPlan(
      activeConversation,
      latestMessage.content || '请结合附件规划当前项目',
      latestMessage.attachments,
      latestTask.id,
    ).catch(() => undefined)
  }, [activeConversation, planPending, runPlan])

  const sendMessage = useCallback(
    async (content: string, attachments: AgentAttachmentInput[], files: AgentFileSelection[]) => {
      if (!user || !projectId || !project) return
      const conversation =
        activeConversation ??
        createAgentConversation({
          ownerUserId: user.id,
          projectId,
          projectName: project.name,
          title: content.slice(0, 40) || '新对话',
        })
      const latestTask = conversation.tasks.at(-1)
      const pendingQuestion = latestTask?.status === 'waiting_user' ? latestTask.pendingQuestion : undefined
      const uploadedAttachments = files.length ? await uploadAgentFiles(projectId, conversation.id, files) : attachments
      const updated = appendAgentTurn({
        ownerUserId: user.id,
        conversationId: conversation.id,
        content,
        attachments: uploadedAttachments,
      })
      const task = updated.tasks.at(-1)
      const userTurn = updated.messages.at(-1)
      refreshLocalState(updated.id)
      if (conversationId !== updated.id) {
        navigate(`/projects/${projectId}/agent/${updated.id}`, { replace: true })
      }
      if (task) {
        await runPlan(
          updated,
          content || '请结合附件规划当前项目',
          uploadedAttachments,
          task.id,
          pendingQuestion && userTurn?.role === 'user'
            ? { questionId: pendingQuestion.id, turnId: userTurn.id }
            : undefined,
        )
      }
    },
    [activeConversation, conversationId, navigate, project, projectId, refreshLocalState, runPlan, user],
  )

  const retryCurrentPlan = useCallback(async () => {
    const task = activeConversation?.tasks.at(-1)
    if (!user || !activeConversation || !task) return
    if (task.run && ['planning', 'running', 'prepared'].includes(task.run.status)) {
      await resumeAgentRun(activeConversation, task)
      return
    }
    const message = getTaskUserMessage(activeConversation, task.id)
    if (!message) {
      setPlanError('找不到当前任务的原始输入，请发送一条新消息。')
      return
    }
    const retryConversation = appendAgentTurn({
      ownerUserId: user.id,
      conversationId: activeConversation.id,
      content: message.content,
      attachments: message.attachments,
    })
    const retryTask = retryConversation.tasks.at(-1)
    if (!retryTask) {
      setPlanError('无法创建新的重试任务，请重新发送一条消息。')
      return
    }
    refreshLocalState(retryConversation.id)
    await runPlan(retryConversation, message.content || '请结合附件规划当前项目', message.attachments, retryTask.id)
  }, [activeConversation, refreshLocalState, resumeAgentRun, runPlan, user])

  const retryContextProposal = useCallback(async () => {
    const task = activeConversation?.tasks.at(-1)
    if (!activeConversation || !task) return
    const userMessage = getTaskUserMessage(activeConversation, task.id)
    const assistantMessage = activeConversation.messages.find(
      message => message.role === 'assistant' && message.taskId === task.id,
    )
    if (!userMessage || !assistantMessage) {
      setContextError('找不到本轮蓝图，无法重新整理项目上下文。')
      setContextRetryMode('proposal')
      return
    }

    setContextRetryPending(true)
    try {
      createContextProposal(userMessage.content || '请结合附件规划当前项目', assistantMessage.content, task.id)
      setContextError(null)
      setContextRetryMode(null)
      refreshLocalState(activeConversation.id)
    } catch {
      setContextError('项目上下文仍未保存，请稍后重试或手动补充。')
      setContextRetryMode('proposal')
    } finally {
      setContextRetryPending(false)
    }
  }, [activeConversation, createContextProposal, refreshLocalState])

  const createConversation = () => {
    if (!user || !projectId || !project) return
    const next = createAgentConversation({
      ownerUserId: user.id,
      projectId,
      projectName: project.name,
      title: '新对话',
    })
    setPlanError(null)
    setContextError(null)
    setContextRetryMode(null)
    refreshLocalState(next.id)
    navigate(`/projects/${projectId}/agent/${next.id}`)
  }

  const selectConversation = (nextConversationId: string) => {
    if (!projectId) return
    setPlanError(null)
    setContextError(null)
    setContextRetryMode(null)
    refreshLocalState(nextConversationId)
    navigate(`/projects/${projectId}/agent/${nextConversationId}`)
  }

  if (!projectId) {
    return <AgentPageState title='项目地址无效' detail='请从项目列表重新打开。' />
  }

  if (projectError) {
    return (
      <AgentPageState
        tone='error'
        title='无法打开 Agent 工作区'
        detail={projectError}
        action={
          <Button
            type='button'
            onClick={() => setProjectAttempt(attempt => attempt + 1)}
            className='h-8 rounded-[6px] bg-[var(--ed-ink)] text-xs text-[var(--ed-canvas)] hover:bg-white'
          >
            <RotateCw className='size-3.5' />
            重新加载
          </Button>
        }
      />
    )
  }

  if (!project || !user) {
    return <AgentPageState title='正在打开 Agent 工作区…' detail='读取项目、私有对话和当前草稿。' loading />
  }

  const latestTask = activeConversation?.tasks.at(-1)
  const planningStage = latestTask?.stages.find(stage => stage.id === 'plan-layout')
  const failedPlanDetail =
    planningStage?.detail?.startsWith('规划请求失败：') || planningStage?.detail?.startsWith('规划结果待恢复：')
      ? planningStage.detail
      : null
  const visibleNotice =
    planError ??
    failedPlanDetail ??
    contextError ??
    draftRefreshError ??
    (workspaceSyncStatus === 'offline'
      ? '服务端工作区暂时不可用，当前变更保存在本机并将在恢复后同步。'
      : workspaceSyncStatus === 'error'
        ? '工作区同步失败，请稍后重试。'
        : workspaceRecoveryWarning
          ? '检测到无法读取的旧 Agent 本地数据，原始副本已隔离保留；当前从空白 Agent 状态继续。'
          : null)
  const retrySharedContexts = async () => {
    setContextRetryPending(true)
    try {
      await refreshSharedContexts()
      setContextError(null)
      setContextRetryMode(null)
    } catch (reason) {
      setContextError(reason instanceof Error ? reason.message : '共享项目上下文加载失败，请重试。')
      setContextRetryMode('shared')
    } finally {
      setContextRetryPending(false)
    }
  }
  const retryNotice =
    planError || failedPlanDetail
      ? retryCurrentPlan
      : contextError
        ? contextRetryMode === 'proposal'
          ? retryContextProposal
          : retrySharedContexts
        : undefined
  const retryLabel =
    planError || failedPlanDetail
      ? '重试当前阶段'
      : contextError
        ? contextRetryMode === 'proposal'
          ? '重试保存上下文'
          : '重试共享上下文'
        : undefined
  const editorHref = activeConversation
    ? `/projects/${projectId}/editor?conversation=${encodeURIComponent(activeConversation.id)}`
    : `/projects/${projectId}/editor`

  const saveContextDraft = async (draft: { id?: string; title: string; content: string }): Promise<boolean> => {
    setContextError(null)
    setContextRetryMode(null)
    const shared = draft.id ? sharedContexts.find(context => context.id === draft.id) : undefined
    try {
      if (shared) {
        await saveSharedProjectContext(projectId, {
          id: shared.id,
          expectedRevision: shared.revision,
          title: draft.title,
          content: draft.content,
        })
        await refreshSharedContexts()
      } else {
        upsertProjectContext({
          ownerUserId: user.id,
          projectId,
          contextId: draft.id,
          title: draft.title,
          content: draft.content,
          status: 'pending',
        })
        refreshLocalState()
      }
      return true
    } catch (reason) {
      if (isSharedProjectContextConflict(reason)) await refreshSharedContexts().catch(() => undefined)
      setContextError(contextMutationErrorMessage(reason))
      setContextRetryMode('shared')
      return false
    }
  }

  const confirmContext = async (contextId: string) => {
    const pending = pendingContexts.find(context => context.id === contextId)
    if (!pending) return
    setContextError(null)
    setContextRetryMode(null)
    try {
      await saveSharedProjectContext(projectId, {
        title: pending.title,
        content: pending.content,
        sourceTaskId: pending.sourceTaskId,
        provenance: pending.provenance,
      })
      deleteProjectContext(user.id, projectId, pending.id)
      refreshLocalState()
      await refreshSharedContexts()
    } catch (reason) {
      setContextError(contextMutationErrorMessage(reason))
      setContextRetryMode('shared')
    }
  }

  const deleteContext = async (contextId: string) => {
    const shared = sharedContexts.find(context => context.id === contextId)
    setContextError(null)
    setContextRetryMode(null)
    try {
      if (shared) {
        await deleteSharedProjectContext(projectId, shared.id, shared.revision)
        await refreshSharedContexts()
      } else {
        deleteProjectContext(user.id, projectId, contextId)
        refreshLocalState()
      }
    } catch (reason) {
      if (isSharedProjectContextConflict(reason)) await refreshSharedContexts().catch(() => undefined)
      setContextError(contextMutationErrorMessage(reason))
      setContextRetryMode('shared')
    }
  }

  const rollbackContext = async (contextId: string) => {
    const shared = sharedContexts.find(context => context.id === contextId)
    if (!shared) {
      rollbackProjectContext(user.id, projectId, contextId)
      refreshLocalState()
      return
    }
    const targetRevision = shared.history.at(-1)?.revision
    if (targetRevision === undefined) return
    setContextError(null)
    setContextRetryMode(null)
    try {
      await rollbackSharedProjectContext(projectId, shared.id, {
        expectedRevision: shared.revision,
        targetRevision,
      })
      await refreshSharedContexts()
    } catch (reason) {
      if (isSharedProjectContextConflict(reason)) await refreshSharedContexts().catch(() => undefined)
      setContextError(contextMutationErrorMessage(reason))
      setContextRetryMode('shared')
    }
  }

  const rollbackRun = async (operationId: string) => {
    setRollbackPendingOperationId(operationId)
    setPlanError(null)
    try {
      const undo = await undoAgentRun(projectId, operationId)
      await refreshProjectDraft('回滚')
      const ownerConversation = conversations.find(conversation =>
        conversation.tasks.some(task => task.run?.operationId === operationId),
      )
      if (ownerConversation) {
        recordAgentRunRollback({
          ownerUserId: user.id,
          conversationId: ownerConversation.id,
          operationId,
          receipt: undo.receipt,
          updatedAt: undo.rolledBackAt,
        })
        refreshLocalState(ownerConversation.id)
      }
      setRolledBackOperationIds(current => new Set(current).add(operationId))
    } catch (reason) {
      setPlanError(reason instanceof Error ? reason.message : '回滚失败，请稍后重试。')
    } finally {
      setRollbackPendingOperationId(null)
    }
  }

  return (
    <div
      data-ed-shell='agent'
      className='relative h-dvh min-w-[1024px] overflow-hidden bg-[var(--ed-canvas)] text-[var(--ed-ink)]'
    >
      <div className='flex h-dvh min-w-[1024px] flex-col overflow-hidden'>
        <motion.header
          className='relative flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[var(--ed-line)] bg-[var(--ed-rail)] px-3.5'
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className='flex min-w-0 max-w-[34%] items-center gap-3'>
            <Link
              to='/'
              aria-label='返回工作台'
              title='返回工作台'
              className='grid size-8 shrink-0 place-items-center rounded-[6px] text-[var(--ed-ink-muted)] outline-none transition-colors hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              <ArrowLeft className='size-3.5' aria-hidden='true' />
            </Link>
            <span aria-hidden='true' className='h-5 w-px bg-[var(--ed-line)]' />
            <div className='min-w-0'>
              <p className='truncate text-[15px] font-medium leading-5 text-[var(--ed-ink)]'>{project.name}</p>
              <p className='mt-1 text-[10px] leading-3 text-[var(--ed-ink-muted)]'>草稿 v{project.draftVersion}</p>
            </div>
          </div>

          <nav
            aria-label='编辑模式'
            className='absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center rounded-[7px] border border-[var(--ed-line)] bg-[var(--ed-canvas)] p-0.5'
          >
            <span
              aria-current='page'
              className='inline-flex h-7 items-center gap-1.5 rounded-[5px] bg-[var(--ed-panel-raised)] px-2.5 text-[10px] font-medium text-[var(--ed-ink)] shadow-[inset_0_0_0_1px_var(--ed-line)]'
            >
              <MessageSquareText className='size-3' aria-hidden='true' />
              Agent 创作
            </span>
            <Link
              to={editorHref}
              className='inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[10px] text-[var(--ed-ink-muted)] transition-colors hover:bg-[var(--ed-panel)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              <PencilRuler className='size-3' aria-hidden='true' />
              手动编辑
            </Link>
          </nav>

          <div className='flex min-w-0 max-w-[34%] items-center justify-end gap-1'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => setContextOpen(true)}
              className='h-8 gap-1.5 rounded-[6px] px-2.5 text-[11px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
            >
              <BookOpenText className='size-3.5' />
              项目上下文
              {contexts.some(context => context.status === 'pending') ? (
                <span className='text-[9px] text-[var(--ed-warning)]'>待确认</span>
              ) : null}
            </Button>
            <Button
              asChild
              variant='outline'
              size='sm'
              className='h-8 gap-1.5 rounded-[6px] border-[var(--ed-line-strong)] bg-transparent px-2.5 text-[11px] text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
            >
              <Link to={`/projects/${projectId}/preview`} target='_blank'>
                完整预览
                <ArrowUpRight className='size-3.5' />
              </Link>
            </Button>
          </div>
        </motion.header>

        <main className='flex min-h-0 flex-1'>
          <motion.div
            className='flex min-h-0 shrink-0 self-stretch'
            initial={reduceMotion ? false : { opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, delay: reduceMotion ? 0 : 0.04, ease: [0.16, 1, 0.3, 1] }}
          >
            <ConversationThread
              conversation={activeConversation}
              conversations={conversations}
              defaultAttachmentScope={agentPreferences.defaultAttachmentScope}
              notice={visibleNotice}
              planPending={planPending}
              retryLabel={retryLabel}
              retryPending={planPending || contextRetryPending}
              showTaskProgress={agentPreferences.showTaskProgress}
              onCreateConversation={createConversation}
              onRetry={retryNotice}
              onRollback={operationId => void rollbackRun(operationId)}
              rollbackPendingOperationId={rollbackPendingOperationId}
              rolledBackOperationIds={rolledBackOperationIds}
              onSelectConversation={selectConversation}
              onSend={sendMessage}
            />
          </motion.div>
          <motion.section
            aria-label='当前画布'
            className='relative flex min-w-0 flex-1 flex-col bg-[#030507]'
            initial={reduceMotion ? false : { opacity: 0, x: 18, scale: 0.992 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.38, delay: reduceMotion ? 0 : 0.06, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className='flex h-11 shrink-0 items-center justify-between border-b border-[var(--ed-line)] bg-[var(--ed-rail)] px-3.5'>
              <span className='flex items-center gap-1.5 text-[10px] text-[var(--ed-ink-muted)]'>
                <LayoutDashboard className='size-3' />
                实时画布
              </span>
              {planPending ? (
                <span className='flex items-center gap-1.5 text-[10px] text-[var(--ed-ink-muted)]'>
                  <LoaderCircle className='size-3 animate-spin' />
                  正在更新
                </span>
              ) : (
                <span className='flex items-center gap-1.5 text-[10px] text-[var(--ed-ink-muted)]'>
                  <span className='size-1.5 rounded-full bg-[var(--ed-success)]' />
                  草稿已同步
                </span>
              )}
            </div>
            <div className='relative min-h-0 flex-1'>
              <ProjectSchemaRenderer
                project={project}
                createDataSourceEngine={createDataSourceEngine as PreviewDataSourceEngine}
                showPreviewScaleControls
              />
            </div>
          </motion.section>
        </main>
      </div>

      <ProjectContextSheet
        contexts={contexts}
        open={contextOpen}
        onOpenChange={setContextOpen}
        onConfirm={contextId => void confirmContext(contextId)}
        onDelete={contextId => void deleteContext(contextId)}
        onRollback={contextId => void rollbackContext(contextId)}
        onSave={saveContextDraft}
      />
    </div>
  )
}

function AgentPageState({
  title,
  detail,
  action,
  loading = false,
  tone = 'default',
}: {
  title: string
  detail: string
  action?: React.ReactNode
  loading?: boolean
  tone?: 'default' | 'error'
}) {
  return (
    <div
      data-ed-shell='agent'
      className='grid min-h-[100dvh] min-w-[1024px] place-items-center bg-[var(--ed-canvas)] p-6 text-[var(--ed-ink)]'
    >
      <div className='max-w-md border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-6 py-5 text-center'>
        {loading ? (
          <LoaderCircle className='mx-auto size-5 animate-spin text-[var(--ed-cyan)]' />
        ) : tone === 'error' ? (
          <CircleAlert className='mx-auto size-5 text-[var(--ed-error)]' />
        ) : (
          <LayoutDashboard className='mx-auto size-5 text-[var(--ed-cyan)]' />
        )}
        <h1 className='mt-3 text-sm font-medium'>{title}</h1>
        <p className='mt-2 text-xs leading-5 text-[var(--ed-ink-muted)]'>{detail}</p>
        {action ? <div className='mt-4 flex justify-center'>{action}</div> : null}
      </div>
    </div>
  )
}
