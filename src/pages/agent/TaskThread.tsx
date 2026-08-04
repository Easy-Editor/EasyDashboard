import { type AgentTask, type AgentTaskTechnicalDetails, formatAgentRunCost } from '@/features/agent'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDashed,
  LoaderCircle,
  MessageCircleQuestion,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

type TodoTone = 'waiting' | 'running' | 'complete' | 'failed'

type TaskStepView = {
  id: string
  title: string
  status: string
  detail?: string
}

function hasTechnicalDetails(details: AgentTaskTechnicalDetails | undefined): details is AgentTaskTechnicalDetails {
  return Boolean(details && (details.errorCode || details.operationId || details.receiptId || details.cost))
}

function formatTechnicalCost(details: NonNullable<AgentTaskTechnicalDetails['cost']>): string {
  const amount = (details.amountMicros / 1_000_000).toFixed(6)
  const accuracyLabels = {
    actual: '实际',
    estimated: '估算',
    billing_indeterminate: '待确认',
  } as const
  return details.accuracy ? `$${amount}（${accuracyLabels[details.accuracy]}）` : `$${amount}`
}

export function resolveTaskSteps(task: AgentTask): TaskStepView[] {
  return task.activePlan?.steps ?? task.plan?.steps ?? task.stages
}

export function resolveTodoSummary(task: AgentTask): { label: string; detail: string; tone: TodoTone } {
  if (task.taskRun?.status === 'rolled_back') {
    return { label: '任务已回滚', detail: '本次任务的已提交修改已回滚', tone: 'waiting' }
  }
  if (task.taskRun?.status === 'rollback_blocked') {
    return { label: '回滚受阻', detail: '部分修改无法安全回滚，请查看活动详情', tone: 'failed' }
  }
  if (task.taskRun?.status === 'blocked_material') {
    return { label: '缺少可用物料', detail: 'Agent 已记录物料缺口，等待选择替代方案', tone: 'waiting' }
  }
  if (task.status === 'failed') {
    return { label: '执行失败', detail: '任务未完成，请查看失败阶段', tone: 'failed' }
  }
  if (task.status === 'canceled') {
    return { label: '已取消', detail: '任务已取消，未完成阶段仍保留', tone: 'waiting' }
  }
  if (task.status === 'paused') {
    return { label: '已暂停', detail: '任务已暂停，可继续执行', tone: 'waiting' }
  }
  if (task.status === 'waiting_user') {
    return { label: '等待回复', detail: 'Agent 需要你的回复才能继续', tone: 'waiting' }
  }
  if (task.status === 'complete') {
    return { label: '已完成', detail: '全部阶段已完成', tone: 'complete' }
  }
  const statuses = resolveTaskSteps(task).map(stage => stage.status)
  if (statuses.includes('failed')) {
    return { label: '执行失败', detail: '任务未完成，请查看失败阶段', tone: 'failed' }
  }
  if (statuses.some(status => ['running', 'verifying', 'revising'].includes(status))) {
    return { label: '运行中', detail: 'Agent 正在处理当前阶段', tone: 'running' }
  }
  if (statuses.includes('waiting') || ['waiting', 'waiting_user', 'paused'].includes(task.status)) {
    return { label: '等待中', detail: '当前阶段正在等待继续执行', tone: 'waiting' }
  }
  if (statuses.length > 0 && statuses.every(status => ['complete', 'passed', 'superseded'].includes(status))) {
    return { label: '已完成', detail: '全部阶段已完成', tone: 'complete' }
  }
  return { label: '待处理', detail: '任务尚未开始执行', tone: 'waiting' }
}

function resolveStageStatusLabel(stage: TaskStepView): string {
  if (stage.status === 'complete' || stage.status === 'passed') return '已完成'
  if (stage.status === 'superseded') return '已替代'
  if (stage.status === 'failed') return '失败'
  if (stage.status === 'running' || stage.status === 'revising') return '运行中'
  if (stage.status === 'verifying') return '检查中'
  if (stage.status === 'waiting') return '等待中'
  return '待处理'
}

function StageIcon({ stage }: { stage: TaskStepView }) {
  if (stage.status === 'complete' || stage.status === 'passed' || stage.status === 'superseded') {
    return <CheckCircle2 className='size-4 text-[var(--ed-success)]' strokeWidth={1.8} aria-hidden='true' />
  }
  if (stage.status === 'failed') {
    return <AlertCircle className='size-4 text-[var(--ed-error)]' strokeWidth={1.8} aria-hidden='true' />
  }
  if (stage.status === 'running' || stage.status === 'verifying' || stage.status === 'revising') {
    return (
      <LoaderCircle
        className='size-4 animate-spin text-[var(--ed-cyan)] motion-reduce:animate-none'
        strokeWidth={1.8}
        aria-hidden='true'
      />
    )
  }
  if (stage.status === 'waiting') {
    return <CircleDashed className='size-4 text-[var(--ed-cyan)]' strokeWidth={1.8} aria-hidden='true' />
  }
  return <Circle className='size-4 text-[var(--ed-ink-faint)]' strokeWidth={1.6} aria-hidden='true' />
}

export function TaskThread({
  task,
  rollbackPending = false,
  rolledBack = false,
  defaultExpanded = true,
  onRollback,
}: {
  task: AgentTask
  rollbackPending?: boolean
  rolledBack?: boolean
  defaultExpanded?: boolean
  onRollback?: (operationId: string) => void
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [technicalOpen, setTechnicalOpen] = useState(false)
  const reduceMotion = useReducedMotion()
  const summary = resolveTodoSummary(task)
  const costDescription = formatAgentRunCost(task.run?.cost)
  const steps = resolveTaskSteps(task)
  const completedCount = steps.filter(stage => ['complete', 'passed', 'superseded'].includes(stage.status)).length
  const activeStageIndex = steps.findIndex(stage =>
    ['running', 'waiting', 'verifying', 'revising'].includes(stage.status),
  )
  const currentStageIndex =
    activeStageIndex >= 0 ? activeStageIndex : Math.max(0, Math.min(completedCount, steps.length) - 1)
  const currentStage = steps[currentStageIndex]
  const currentStep = steps.length === 0 ? 0 : currentStageIndex + 1

  return (
    <motion.section
      aria-label={`任务：${task.title}`}
      aria-live='polite'
      data-task-thread='current'
      className='shrink-0'
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div
        aria-hidden={!expanded}
        inert={!expanded}
        className='grid origin-bottom'
        initial={false}
        animate={{ gridTemplateRows: expanded ? '1fr' : '0fr', opacity: expanded ? 1 : 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className='min-h-0 overflow-hidden'>
          <div className='mx-auto max-h-44 w-[calc(100%-28px)] max-w-[380px] overflow-y-auto rounded-[14px] border border-[var(--ed-line)] bg-[var(--ed-panel)] p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.16)]'>
            {task.activePlan ? (
              <header className='mx-2 mb-1.5 flex items-start justify-between gap-3 border-b border-[var(--ed-line)] px-0.5 py-2'>
                <p className='min-w-0 text-[10px] leading-4 text-[var(--ed-ink-muted)]'>{task.activePlan.summary}</p>
                <span className='shrink-0 font-mono text-[9px] text-[var(--ed-ink-faint)]'>
                  计划 v{task.activePlan.version}
                </span>
              </header>
            ) : null}
            <ol className='space-y-0.5'>
              {steps.map((stage, stageIndex) => {
                const isComplete = ['complete', 'passed', 'superseded'].includes(stage.status)
                const isActive = ['waiting', 'running', 'verifying', 'revising'].includes(stage.status)
                const isFailed = stage.status === 'failed'
                const isLast = stageIndex === steps.length - 1
                return (
                  <li
                    key={stage.id}
                    aria-label={`${stage.title}，${resolveStageStatusLabel(stage)}`}
                    className={`relative flex min-h-8 min-w-0 items-start gap-2.5 rounded-[9px] px-2.5 py-2 ${
                      isActive
                        ? 'bg-[var(--ed-panel-raised)] shadow-[inset_2px_0_0_var(--ed-cyan)]'
                        : isFailed
                          ? 'bg-[color-mix(in_srgb,var(--ed-error)_6%,transparent)]'
                          : ''
                    }`}
                  >
                    {isLast ? null : (
                      <span
                        className='absolute left-[18px] top-[23px] h-[calc(100%-13px)] w-px bg-[var(--ed-line-strong)]'
                        aria-hidden='true'
                      />
                    )}
                    <span className='relative z-[1] mt-px grid size-4 shrink-0 place-items-center bg-[var(--ed-panel)]'>
                      <StageIcon stage={stage} />
                    </span>
                    <span className='min-w-0 flex-1'>
                      <span
                        className={`block text-[12px] leading-4 ${isActive ? 'font-medium' : 'font-normal'} ${
                          isComplete
                            ? 'text-[var(--ed-ink-muted)]'
                            : isActive
                              ? 'text-[var(--ed-ink)]'
                              : 'text-[var(--ed-ink-muted)]'
                        }`}
                      >
                        {stage.title}
                      </span>
                      {stage.detail && isFailed ? (
                        <span className='mt-0.5 block text-[10px] leading-4 text-[var(--ed-ink-faint)]'>
                          {stage.detail}
                        </span>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ol>

            {task.pendingQuestion ? (
              <aside
                aria-label='等待你的回复'
                className='mx-2 mt-2 rounded-[9px] border border-[color-mix(in_srgb,var(--ed-warning)_38%,var(--ed-line))] bg-[color-mix(in_srgb,var(--ed-warning)_7%,transparent)] px-2.5 py-2.5'
              >
                <div className='flex items-center gap-1.5 text-[10px] font-medium text-[var(--ed-warning)]'>
                  <MessageCircleQuestion className='size-3.5' aria-hidden='true' />
                  Agent 需要你确认
                </div>
                <p className='mt-1.5 text-[11px] leading-4 text-[var(--ed-ink-soft)]'>{task.pendingQuestion.prompt}</p>
                <p className='mt-1 text-[10px] leading-4 text-[var(--ed-ink-faint)]'>
                  直接在下方回复后，将继续同一任务。
                </p>
              </aside>
            ) : null}

            {task.activities?.length ? (
              <div aria-label='任务活动' className='mx-2 mt-2 border-t border-[var(--ed-line)] pt-2'>
                <p className='mb-1.5 text-[10px] font-medium text-[var(--ed-ink-muted)]'>最近活动</p>
                <ol className='space-y-1.5'>
                  {task.activities.slice(-8).map(activity => (
                    <li key={activity.seq} className='text-[10px] leading-4 text-[var(--ed-ink-muted)]'>
                      <div className='flex items-start gap-2'>
                        <span
                          className='mt-[7px] size-1 shrink-0 rounded-full bg-[var(--ed-line-strong)]'
                          aria-hidden='true'
                        />
                        <span className='min-w-0 flex-1'>{activity.summary}</span>
                        <time className='shrink-0 font-mono text-[9px] text-[var(--ed-ink-faint)]'>
                          {new Date(activity.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </time>
                      </div>
                      {hasTechnicalDetails(activity.technicalDetails) ? (
                        <details className='ml-3 mt-0.5 text-[9px] text-[var(--ed-ink-faint)]'>
                          <summary className='cursor-pointer select-none hover:text-[var(--ed-ink-muted)]'>
                            技术信息
                          </summary>
                          <dl className='mt-1 space-y-0.5 rounded-[5px] bg-[var(--ed-rail)] p-1.5 font-mono'>
                            {activity.technicalDetails.errorCode ? (
                              <div>
                                <dt className='inline'>错误码：</dt>
                                <dd className='inline break-all'>{activity.technicalDetails.errorCode}</dd>
                              </div>
                            ) : null}
                            {activity.technicalDetails.operationId ? (
                              <div>
                                <dt className='inline'>执行标识：</dt>
                                <dd className='inline break-all'>{activity.technicalDetails.operationId}</dd>
                              </div>
                            ) : null}
                            {activity.technicalDetails.receiptId ? (
                              <div>
                                <dt className='inline'>凭据标识：</dt>
                                <dd className='inline break-all'>{activity.technicalDetails.receiptId}</dd>
                              </div>
                            ) : null}
                            {activity.technicalDetails.cost ? (
                              <div>
                                <dt className='inline'>费用：</dt>
                                <dd className='inline'>{formatTechnicalCost(activity.technicalDetails.cost)}</dd>
                              </div>
                            ) : null}
                          </dl>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {task.run || task.taskRun ? (
              <div className='mx-2 mt-1 border-t border-[var(--ed-line)] px-0.5 pt-2 pb-0.5'>
                <button
                  type='button'
                  aria-expanded={technicalOpen}
                  onClick={() => setTechnicalOpen(current => !current)}
                  className='flex w-full items-center justify-between text-[10px] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink-muted)]'
                >
                  执行详情
                  {technicalOpen ? (
                    <ChevronUp className='size-3' aria-hidden='true' />
                  ) : (
                    <ChevronDown className='size-3' aria-hidden='true' />
                  )}
                </button>
                {technicalOpen ? (
                  <div className='pt-2'>
                    {task.run?.trace?.skills.length ? (
                      <div className='mb-2 flex flex-wrap items-center gap-1.5 text-[10px]'>
                        <span className='text-[var(--ed-ink-faint)]'>使用技能</span>
                        {task.run.trace.skills.map(skill => (
                          <span
                            key={skill}
                            className='rounded-full border border-[var(--ed-line-strong)] px-1.5 py-0.5 font-mono text-[var(--ed-cyan)]'
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <dl className='grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--ed-ink-faint)]'>
                      <dt>执行状态</dt>
                      <dd className='text-right text-[var(--ed-ink-muted)]'>
                        {task.taskRun?.status ?? task.run?.status}
                      </dd>
                      <dt>执行标识</dt>
                      <dd className='truncate text-right'>{task.taskRunId ?? task.run?.operationId}</dd>
                      {task.taskRun ? (
                        <>
                          <dt>模型</dt>
                          <dd className='truncate text-right'>{task.taskRun.modelBinding.model}</dd>
                          <dt>模型调用</dt>
                          <dd className='text-right'>{task.taskRun.accounting.providerTurns} 次</dd>
                        </>
                      ) : null}
                      {costDescription ? (
                        <>
                          <dt>费用</dt>
                          <dd className='text-right'>{costDescription}</dd>
                        </>
                      ) : null}
                      {task.run?.receipt ? (
                        <>
                          <dt>执行凭据</dt>
                          <dd className='text-right text-[var(--ed-success)]'>已记录</dd>
                        </>
                      ) : null}
                      {task.run?.rollback ? (
                        <>
                          <dt>回滚</dt>
                          <dd className='text-right text-[var(--ed-cyan)]'>
                            {onRollback ? (
                              <button
                                type='button'
                                disabled={rollbackPending || rolledBack}
                                onClick={() => onRollback(task.run!.operationId)}
                                className='hover:text-[var(--ed-ink)] disabled:opacity-50'
                              >
                                {rolledBack ? '已回滚' : rollbackPending ? '回滚中…' : '回滚本次执行'}
                              </button>
                            ) : (
                              '可用'
                            )}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </motion.div>
      <button
        type='button'
        aria-expanded={expanded}
        onClick={() => setExpanded(current => !current)}
        className='mx-auto mt-2 flex h-8 max-w-full items-center gap-2 rounded-full border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] px-3 text-left text-[11px] text-[var(--ed-ink-muted)] outline-none transition-colors hover:border-[var(--ed-cyan)]/35 hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)] active:scale-[0.98] motion-reduce:transition-none'
      >
        {currentStage ? <StageIcon stage={currentStage} /> : null}
        <span className='truncate'>
          {steps.length > 0 ? (
            <>
              第 {currentStep} / {steps.length} 步<span className='mx-1.5 text-[var(--ed-ink-faint)]'>·</span>
              {currentStage?.title ?? summary.label}
            </>
          ) : (
            summary.label
          )}
        </span>
        <motion.span
          className='ml-auto shrink-0'
          aria-hidden='true'
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
        >
          <ChevronDown className='size-3.5 text-[var(--ed-ink-faint)]' aria-hidden='true' />
        </motion.span>
      </button>
      <p className='sr-only'>
        {summary.label}：{summary.detail}
      </p>
    </motion.section>
  )
}
