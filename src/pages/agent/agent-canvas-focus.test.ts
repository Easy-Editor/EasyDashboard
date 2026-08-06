import type { AgentTask } from '@/features/agent'
import { describe, expect, it } from 'vitest'
import { resolveAgentCanvasActivity } from './agent-canvas-focus'

const schema = {
  version: '1.0.0',
  componentsTree: [
    {
      id: 'page-home',
      componentName: 'Root',
      fileName: 'home',
      $dashboard: { rect: { x: 0, y: 0, width: 1920, height: 1080 } },
      children: [
        {
          id: 'title',
          componentName: 'Text',
          extra: { title: '顶部英文副标题' },
          props: { text: 'SMART FACTORY OPERATION CENTER' },
          $dashboard: { rect: { x: 560, y: 54, width: 800, height: 72 } },
        },
        {
          id: 'ranking',
          componentName: 'ScrollList',
          extra: { title: '车间产量排行' },
          $dashboard: { rect: { x: 1500, y: 560, width: 360, height: 250 } },
        },
      ],
    },
  ],
}

function taskWithIntent(intent: Record<string, unknown>): AgentTask {
  return {
    id: 'task-1',
    title: '替换顶部英文副标题',
    status: 'running',
    stages: [],
    activePlan: {
      id: 'plan-1',
      version: 1,
      summary: '更新标题',
      assumptions: [],
      verification: {},
      createdAt: '2026-08-05T00:00:00.000Z',
      steps: [
        {
          id: 'step-title',
          planVersion: 1,
          ordinal: 1,
          semanticStepKey: 'title',
          title: '替换顶部英文副标题',
          intent,
          status: 'running',
          lastObservation: null,
          createdAt: '2026-08-05T00:00:00.000Z',
          updatedAt: '2026-08-05T00:00:01.000Z',
        },
      ],
    },
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:01.000Z',
  }
}

describe('resolveAgentCanvasActivity', () => {
  it('locates the actual canvas component from a semantic target name', () => {
    const activity = resolveAgentCanvasActivity(
      taskWithIntent({ description: '替换顶部英文副标题并保持其他区域不变' }),
      schema,
    )

    expect(activity).toEqual({
      label: '替换顶部英文副标题',
      detail: '正在更新 顶部英文副标题',
      targets: [
        {
          id: 'title',
          label: '顶部英文副标题',
          rect: { x: 560, y: 54, width: 800, height: 72 },
        },
      ],
    })
  })

  it('prefers an internal selected node reference without exposing it as visible copy', () => {
    const activity = resolveAgentCanvasActivity(
      taskWithIntent({ selectionContext: { selectedRefs: [{ id: 'ranking', title: '右侧排行' }] } }),
      schema,
    )

    expect(activity?.targets.map(target => target.id)).toEqual(['ranking'])
    expect(activity?.detail).toBe('正在更新 车间产量排行')
  })

  it('keeps the stage status without pretending it located a component', () => {
    const activity = resolveAgentCanvasActivity(taskWithIntent({ purpose: '整体校验' }), schema)

    expect(activity?.label).toBe('替换顶部英文副标题')
    expect(activity?.targets).toEqual([])
    expect(activity?.detail).toBe('正在处理当前步骤')
  })
})
