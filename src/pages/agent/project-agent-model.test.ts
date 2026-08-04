import type { AgentConversation, AgentTask } from '@/features/agent'
import { describe, expect, it } from 'vitest'
import {
  createAttachmentDrafts,
  describeTask,
  resolveActiveConversation,
  toAttachmentInputs,
} from './project-agent-model'

function conversation(id: string, updatedAt: string): AgentConversation {
  return {
    id,
    ownerUserId: 'user-1',
    projectId: 'project-1',
    visibility: 'private',
    title: id,
    messages: [],
    tasks: [],
    createdAt: updatedAt,
    updatedAt,
  }
}

describe('Project Agent page model', () => {
  it('uses the requested private conversation and otherwise resumes the newest one', () => {
    const conversations = [
      conversation('older', '2026-07-30T08:00:00.000Z'),
      conversation('newer', '2026-07-31T08:00:00.000Z'),
    ]

    expect(resolveActiveConversation(conversations, 'older')?.id).toBe('older')
    expect(resolveActiveConversation(conversations, 'missing')?.id).toBe('newer')
    expect(resolveActiveConversation([])).toBeNull()
  })

  it('defaults selected files to the provided visibility and persists only metadata', () => {
    const drafts = createAttachmentDrafts([{ name: '需求说明.md', type: 'text/markdown', size: 2048 }], 'conversation')

    expect(drafts[0]).toMatchObject({
      name: '需求说明.md',
      mimeType: 'text/markdown',
      size: 2048,
      scope: 'conversation',
    })
    expect(toAttachmentInputs(drafts)[0]).not.toHaveProperty('clientId')
  })

  it('keeps only formats supported by the upload backend', () => {
    const drafts = createAttachmentDrafts(
      [
        { name: '数据.xlsx', type: '', size: 2048 },
        { name: '旧需求.docx', type: '', size: 1024 },
      ],
      'project',
    )

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      name: '数据.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      scope: 'project',
    })
  })

  it('labels an unstarted task honestly', () => {
    const task = {
      id: 'task-1',
      title: 'Agent 搭建任务',
      status: 'waiting',
      stages: [],
      createdAt: '2026-07-31T08:00:00.000Z',
      updatedAt: '2026-07-31T08:00:00.000Z',
    } satisfies AgentTask

    expect(describeTask(task)).toEqual({
      label: '等待中',
      detail: '等待 Agent 开始处理',
      tone: 'waiting',
    })
  })
})
