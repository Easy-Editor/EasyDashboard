import type { AgentTask } from '@/features/agent'
import { AlertCircle, CheckCircle2, ChevronDown, Circle, CircleDashed, LoaderCircle, RotateCcw } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

type TodoTone = 'waiting' | 'running' | 'complete' | 'failed'

type TaskStepView = {
  id: string
  title: string
  status: string
  detail?: string
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
  if (task.status === 'failed') return { label: '执行失败', detail: '任务未完成，请查看失败阶段', tone: 'failed' }
  if (task.status === 'canceled') return { label: '已取消', detail: '任务已取消，未完成阶段仍保留', tone: 'waiting' }
  if (task.status === 'paused') return { label: '已暂停', detail: '处理预算或异常后可继续当前阶段', tone: 'waiting' }
  if (task.status === 'waiting_user')
    return { label: '等待回复', detail: 'Agent 需要你的回复才能继续', tone: 'waiting' }
  if (task.status === 'complete') return { label: '已完成', detail: '全部阶段已完成', tone: 'complete' }
  if (['planning', 'running', 'verifying', 'revising'].includes(task.taskRun?.status ?? task.status)) {
    return { label: 'Agent 正在执行', detail: '当前步骤完成后会同步到右侧画布', tone: 'running' }
  }
  const statuses = resolveTaskSteps(task).map(stage => stage.status)
  if (statuses.includes('failed')) return { label: '执行失败', detail: '任务未完成，请查看失败阶段', tone: 'failed' }
  if (statuses.some(status => ['running', 'verifying', 'revising'].includes(status))) {
    return { label: 'Agent 正在执行', detail: '当前步骤完成后会同步到右侧画布', tone: 'running' }
  }
  if (statuses.includes('waiting') || ['waiting', 'waiting_user', 'paused'].includes(task.status)) {
    return { label: '等待中', detail: '当前阶段正在等待继续执行', tone: 'waiting' }
  }
  if (statuses.length > 0 && statuses.every(status => ['complete', 'passed', 'superseded'].includes(status))) {
    return { label: '已完成', detail: '全部阶段已完成', tone: 'complete' }
  }
  return { label: '待处理', detail: '任务尚未开始执行', tone: 'waiting' }
}

function StageIcon({ status }: { status: string }) {
  if (['complete', 'passed', 'superseded'].includes(status)) {
    return <CheckCircle2 className='size-3.5 text-[var(--ed-success)]' strokeWidth={1.8} aria-hidden='true' />
  }
  if (status === 'failed') {
    return <AlertCircle className='size-3.5 text-[var(--ed-error)]' strokeWidth={1.8} aria-hidden='true' />
  }
  if (['running', 'verifying', 'revising'].includes(status)) {
    return (
      <LoaderCircle
        className='size-3.5 animate-spin text-[var(--ed-cyan)] motion-reduce:animate-none'
        aria-hidden='true'
      />
    )
  }
  if (status === 'waiting') return <CircleDashed className='size-3.5 text-[var(--ed-cyan)]' aria-hidden='true' />
  return <Circle className='size-3.5 text-[var(--ed-ink-faint)]' strokeWidth={1.6} aria-hidden='true' />
}

export function TaskThread({
  task,
  rollbackPending = false,
  rolledBack = false,
  defaultExpanded = false,
  onRollback,
  onResume,
  resumePending = false,
}: {
  task: AgentTask
  rollbackPending?: boolean
  rolledBack?: boolean
  defaultExpanded?: boolean
  onRollback?: (operationId: string) => void
  onResume?: (taskRunId: string) => void
  resumePending?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const reduceMotion = useReducedMotion()
  const summary = resolveTodoSummary(task)
  const steps = resolveTaskSteps(task)
  const completedCount = steps.filter(stage => ['complete', 'passed', 'superseded'].includes(stage.status)).length
  const activeStageIndex = steps.findIndex(stage =>
    ['running', 'waiting', 'verifying', 'revising'].includes(stage.status),
  )
  const currentStageIndex =
    activeStageIndex >= 0 ? activeStageIndex : Math.max(0, Math.min(completedCount, steps.length) - 1)
  const currentStage = steps[currentStageIndex]
  const visibleStart = Math.max(0, currentStageIndex - 1)
  const visibleSteps = steps.slice(visibleStart, visibleStart + 4)
  const hiddenStepCount = Math.max(0, steps.length - visibleSteps.length)

  return (
    <motion.section
      aria-label={`任务：${task.title}`}
      aria-live='polite'
      data-task-thread='current'
      className='shrink-0'
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div
        aria-hidden={!expanded}
        inert={!expanded}
        className='grid origin-bottom'
        initial={false}
        animate={{ gridTemplateRows: expanded ? '1fr' : '0fr', opacity: expanded ? 1 : 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className='min-h-0 overflow-hidden'>
          <div className='mx-auto mb-2 max-h-40 w-[calc(100%-24px)] max-w-[360px] overflow-y-auto rounded-[9px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] px-3 py-2.5 shadow-[0_12px_28px_rgba(0,0,0,0.28)]'>
            <div className='flex items-baseline justify-between gap-3 border-b border-[var(--ed-line-strong)] pb-2'>
              <p className='truncate text-[11px] font-medium text-[var(--ed-ink-soft)]'>{task.title}</p>
              <span className='shrink-0 text-[10px] text-[var(--ed-ink-faint)]'>当前计划</span>
            </div>
            <ol className='mt-2 space-y-1'>
              {visibleSteps.map(stage => (
                <li key={stage.id} className='flex min-h-8 items-start gap-2 py-1.5'>
                  <span className='mt-px grid size-4 shrink-0 place-items-center'>
                    <StageIcon status={stage.status} />
                  </span>
                  <span
                    className={`min-w-0 flex-1 text-[11px] leading-4 ${stage.id === currentStage?.id ? 'font-medium text-[var(--ed-ink)]' : 'text-[var(--ed-ink-muted)]'}`}
                  >
                    {stage.title}
                  </span>
                </li>
              ))}
            </ol>
            {hiddenStepCount > 0 ? (
              <p className='ml-6 mt-1 text-[10px] text-[var(--ed-ink-faint)]'>
                另有 {hiddenStepCount} 步，随执行进度显示
              </p>
            ) : null}
            {task.run?.rollback && onRollback ? (
              <button
                type='button'
                disabled={rollbackPending || rolledBack}
                onClick={() => onRollback(task.run!.operationId)}
                className='mt-2 inline-flex h-8 items-center gap-1 text-[10px] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)] disabled:opacity-50'
              >
                <RotateCcw className='size-3' />
                {rolledBack ? '本次修改已撤销' : rollbackPending ? '正在撤销…' : '撤销本次修改'}
              </button>
            ) : null}
          </div>
        </div>
      </motion.div>

      <button
        type='button'
        aria-expanded={expanded}
        onClick={() => setExpanded(current => !current)}
        className='mx-auto flex h-10 max-w-full items-center gap-2 rounded-full border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] px-3.5 text-left text-[12px] text-[var(--ed-ink-muted)] shadow-[0_8px_24px_rgba(0,0,0,0.24)] outline-none transition-colors hover:border-[var(--ed-cyan)]/45 hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)] active:scale-[0.98] motion-reduce:transition-none'
      >
        {currentStage ? <StageIcon status={currentStage.status} /> : null}
        <span className='truncate'>
          {steps.length > 0
            ? `${currentStageIndex + 1} / ${steps.length} · ${currentStage?.title ?? summary.label}`
            : summary.label}
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

      {task.status === 'paused' && task.taskRunId && onResume ? (
        <button
          type='button'
          disabled={resumePending}
          onClick={() => onResume(task.taskRunId!)}
          className='mx-auto mt-1.5 flex h-8 items-center text-[10px] text-[var(--ed-cyan)] hover:text-[var(--ed-ink)] disabled:opacity-50'
        >
          {resumePending ? '正在继续…' : '继续当前任务'}
        </button>
      ) : null}
      <p className='sr-only'>
        {summary.label}：{summary.detail}
      </p>
    </motion.section>
  )
}
