import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentTask } from '@/features/agent'
import { describe, expect, it } from 'vitest'
import { resolveTaskSteps, resolveTodoSummary } from './TaskThread'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

function createTask(status: AgentTask['status'], stageStatus: AgentTask['stages'][number]['status']): AgentTask {
  return {
    id: 'task-1',
    title: '搭建大屏',
    status,
    stages: [{ id: 'plan-layout', title: '规划布局', status: stageStatus }],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

describe('TaskThread Todo presentation', () => {
  it('shows a compact Codex-like step list with collapsed technical details', async () => {
    const source = await readFile(path.join(currentDirectory, 'TaskThread.tsx'), 'utf8')

    expect(source).toContain("<ol className='space-y-0.5'>")
    expect(source).toContain('第 {currentStep} / {steps.length} 步')
    expect(source).toContain('计划 v{task.activePlan.version}')
    expect(source).toContain('{task.activePlan.summary}')
    expect(source).toContain('currentStage?.title ?? summary.label')
    expect(source).toContain('technicalOpen')
    expect(source).toContain('执行详情')
    expect(source).toContain('{technicalOpen ? (')
    expect(source).toContain('defaultExpanded = true')
    expect(source).toContain("gridTemplateRows: expanded ? '1fr' : '0fr'")
    expect(source).toContain('inert={!expanded}')
    expect(source).toContain("from 'motion/react'")
    expect(source).toContain('useReducedMotion()')
    expect(source).toContain('<motion.section')
    expect(source).toContain('<motion.div')
    expect(source).toContain('max-w-[380px]')
    expect(source).toContain('shadow-[inset_2px_0_0_var(--ed-cyan)]')
    expect(source).toContain('stageIndex === steps.length - 1')
    expect(source).toContain('rounded-full border border-[var(--ed-line-strong)]')
    expect(source).not.toContain('summaryToneClasses')
  })

  it('renders the persisted active plan exactly and only falls back to legacy stages', () => {
    const task = {
      ...createTask('running', 'running'),
      activePlan: {
        version: 3,
        summary: '按参考图搭建主视图',
        steps: [
          { id: 'semantic-1', title: '搭建左右信息面板', status: 'running' },
          { id: 'semantic-2', title: '校验中间地图占比', status: 'pending' },
        ],
      },
    } as AgentTask

    expect(resolveTaskSteps(task).map(step => step.title)).toEqual(['搭建左右信息面板', '校验中间地图占比'])
    expect(resolveTaskSteps({ ...task, activePlan: { ...task.activePlan!, steps: [] } })).toEqual([])
    expect(resolveTaskSteps(createTask('running', 'running')).map(step => step.title)).toEqual(['规划布局'])
  })

  it('derives the aggregate state from stage facts and labels every checklist state', async () => {
    const source = await readFile(path.join(currentDirectory, 'TaskThread.tsx'), 'utf8')

    expect(source).toContain("statuses.includes('failed')")
    expect(source).toContain("['running', 'verifying', 'revising'].includes(status)")
    expect(source).toContain("statuses.includes('waiting')")
    expect(source).toContain("statuses.every(status => ['complete', 'passed', 'superseded'].includes(status))")
    expect(source).toContain("label: '待处理'")
    expect(source).toContain("label: '等待中'")
    expect(source).toContain("label: '运行中'")
    expect(source).toContain("label: '已完成'")
    expect(source).toContain("label: '执行失败'")
  })

  it.each([
    ['canceled', 'waiting', '已取消'],
    ['paused', 'running', '已暂停'],
    ['waiting_user', 'waiting', '等待回复'],
    ['failed', 'running', '执行失败'],
    ['complete', 'waiting', '已完成'],
  ] as const)('prioritizes task status %s over stale stage status', (status, stageStatus, expectedLabel) => {
    expect(resolveTodoSummary(createTask(status, stageStatus)).label).toBe(expectedLabel)
  })

  it('preserves run cost, skill trace, receipt, and rollback details', async () => {
    const source = await readFile(path.join(currentDirectory, 'TaskThread.tsx'), 'utf8')

    expect(source).toContain('formatAgentRunCost(task.run?.cost)')
    expect(source).toContain('task.run?.trace?.skills.length')
    expect(source).toContain('task.run?.receipt')
    expect(source).toContain('onRollback(task.run!.operationId)')
    expect(source).toContain('task.taskRun.modelBinding.model')
    expect(source).toContain('task.taskRun.accounting.providerTurns')
  })

  it('shows public activity, a focused waiting question, and keeps allowlisted technical details collapsed', async () => {
    const source = await readFile(path.join(currentDirectory, 'TaskThread.tsx'), 'utf8')

    expect(source).toContain('task.activities')
    expect(source).toContain("aria-label='任务活动'")
    expect(source).toContain('activity.summary')
    expect(source).toContain('<details')
    expect(source).toContain('activity.technicalDetails')
    expect(source).not.toContain('activity.technicalPayload')
    expect(source).not.toContain('JSON.stringify(activity')
    expect(source).toContain("aria-label='等待你的回复'")
    expect(source).toContain('task.pendingQuestion.prompt')
    expect(source).toContain('任务已回滚')
    expect(source).toContain('回滚受阻')
    expect(source).toContain('缺少可用物料')
  })
})
