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
  it('shows a solid floating task control without an outer panel', async () => {
    const source = await readFile(path.join(currentDirectory, 'TaskThread.tsx'), 'utf8')

    expect(source).toContain("<ol className='mt-2 space-y-1'>")
    expect(source).toContain('visibleSteps')
    expect(source).toContain('hiddenStepCount')
    expect(source).toContain('defaultExpanded = false')
    expect(source).toContain("gridTemplateRows: expanded ? '1fr' : '0fr'")
    expect(source).toContain('inert={!expanded}')
    expect(source).toContain("from 'motion/react'")
    expect(source).toContain('useReducedMotion()')
    expect(source).toContain('<motion.section')
    expect(source).toContain('<motion.div')
    expect(source).toContain('max-w-[360px]')
    expect(source).toContain('rounded-full border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)]')
    expect(source).toContain('rounded-[9px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)]')
    expect(source).not.toContain('执行详情')
    expect(source).not.toContain('计划 v')
    expect(source).not.toContain('bg-[var(--ed-panel)] p-1.5')
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
    expect(source).toContain("label: 'Agent 正在执行'")
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

  it('keeps rollback available without mixing technical telemetry into the task popup', async () => {
    const source = await readFile(path.join(currentDirectory, 'TaskThread.tsx'), 'utf8')

    expect(source).toContain('onRollback(task.run!.operationId)')
    expect(source).toContain('撤销本次修改')
    expect(source).not.toContain('formatAgentRunCost')
    expect(source).not.toContain('模型调用')
    expect(source).not.toContain('执行标识')
  })

  it('keeps execution activity and waiting questions out of the temporary Todo', async () => {
    const source = await readFile(path.join(currentDirectory, 'TaskThread.tsx'), 'utf8')

    expect(source).not.toContain('task.activities')
    expect(source).not.toContain("aria-label='任务活动'")
    expect(source).not.toContain('activity.summary')
    expect(source).not.toContain('task.pendingQuestion.prompt')
    expect(source).toContain('任务已回滚')
    expect(source).toContain('回滚受阻')
    expect(source).toContain('缺少可用物料')
  })
})
