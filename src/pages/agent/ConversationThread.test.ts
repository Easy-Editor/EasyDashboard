import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentConversation, AgentTask } from '@/features/agent'
import { describe, expect, it } from 'vitest'
import { isConversationNearBottom, resolveConversationTimelineItems, shouldShowTaskTodo } from './ConversationThread'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

function createTask(status: AgentTask['status']): AgentTask {
  return {
    id: 'task-1',
    title: '搭建大屏',
    status,
    stages: [],
    taskRunId: 'run-1',
    activities: [
      {
        taskRunId: 'run-1',
        seq: 1,
        eventKey: 'plan-created',
        stepId: null,
        type: 'plan_created',
        summary: '正在规划页面布局',
        publicPayload: {},
        redactionVersion: 1,
        createdAt: '2026-08-01T00:00:01.000Z',
      },
      {
        taskRunId: 'run-1',
        seq: 2,
        eventKey: 'task-completed',
        stepId: null,
        type: 'task_completed',
        summary: '大屏已完成并通过预览检查',
        publicPayload: {},
        redactionVersion: 1,
        createdAt: '2026-08-01T00:00:02.000Z',
      },
    ],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:02.000Z',
  }
}

describe('ConversationThread budget and attachment contracts', () => {
  it('treats a reader near the bottom as following new Agent replies', () => {
    expect(isConversationNearBottom({ scrollTop: 650, clientHeight: 320, scrollHeight: 1000 })).toBe(true)
    expect(isConversationNearBottom({ scrollTop: 400, clientHeight: 320, scrollHeight: 1000 })).toBe(false)
  })

  it('projects durable Agent activity into the same chronological conversation', () => {
    const conversation: AgentConversation = {
      id: 'conversation-1',
      ownerUserId: 'owner-1',
      projectId: 'project-1',
      visibility: 'private',
      title: '搭建运营大屏',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: '照着参考图搭建',
          attachments: [],
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      tasks: [createTask('complete')],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:02.000Z',
    }

    const timeline = resolveConversationTimelineItems(conversation)

    expect(timeline.map(item => item.kind)).toEqual(['message', 'activity', 'activity'])
    expect(timeline.at(-1)?.id).toBe('activity:run-1:task-completed')
  })

  it.each([
    ['running', true],
    ['waiting_user', true],
    ['paused', true],
    ['complete', false],
    ['failed', false],
    ['canceled', false],
  ] as const)('shows the Todo only while status is %s', (status, expected) => {
    expect(shouldShowTaskTodo(createTask(status), true)).toBe(expected)
    expect(shouldShowTaskTodo(createTask(status), false)).toBe(false)
  })

  it('keeps an explicit scroll container and resets it to the latest reply when a conversation is opened', async () => {
    const source = await readFile(path.join(currentDirectory, 'ConversationThread.tsx'), 'utf8')

    expect(source).toContain("data-agent-message-scroll='true'")
    expect(source).toContain('lastConversationIdRef.current !== conversationId')
    expect(source).toContain('messageScroller.scrollTop = messageScroller.scrollHeight')
    expect(source).toContain('shouldFollowMessagesRef.current')
    expect(source).toContain('onScroll={handleMessageScroll}')
  })

  it('shows task and monthly ledger progress with the server warning ratio', async () => {
    const source = await readFile(path.join(currentDirectory, 'ConversationThread.tsx'), 'utf8')

    expect(source).toContain('getAgentBudgetUsage(currentProjectId, currentTaskId)')
    expect(source).toContain("label='当前任务'")
    expect(source).toContain("label='本项目本月'")
    expect(source).toContain('budgetUsage.warningRatio * 100')
    expect(source).toContain("role='progressbar'")
  })

  it('uses the shared backend-supported attachment accept contract', async () => {
    const source = await readFile(path.join(currentDirectory, 'ConversationThread.tsx'), 'utf8')

    expect(source).toContain('accept={AGENT_ATTACHMENT_ACCEPT}')
    expect(source).toContain('AGENT_ATTACHMENT_FORMAT_LABEL')
    expect(source).toContain("附件范围：${attachmentScope === 'conversation'")
    expect(source).toContain("onSelect={() => setAttachmentScope('project')}")
  })

  it('keeps conversation history inside one compact header menu', async () => {
    const source = await readFile(path.join(currentDirectory, 'ConversationThread.tsx'), 'utf8')

    expect(source).toContain("aria-label='切换对话'")
    expect(source).toContain('<DropdownMenuContent')
    expect(source).toContain('conversations.map(candidate =>')
    expect(source).not.toContain('<ConversationSidebar')
    expect(source).not.toContain('historyOpen')
  })

  it('renders exactly one temporary current Todo immediately above the composer', async () => {
    const source = await readFile(path.join(currentDirectory, 'ConversationThread.tsx'), 'utf8')
    const taskReferences = source.match(/<TaskThread/g) ?? []
    const taskIndex = source.indexOf("data-agent-todo='current'")
    const composerIndex = source.indexOf("id='project-agent-message'")

    expect(source).toContain('const latestTask = conversation?.tasks.at(-1)')
    expect(source).toContain('shouldShowTaskTodo(latestTask, showTaskProgress)')
    expect(source).not.toContain('latestTaskId={latestTask?.id}')
    expect(source).not.toContain('conversation.tasks[userTaskIndex++]')
    expect(taskReferences).toHaveLength(1)
    expect(taskIndex).toBeGreaterThan(-1)
    expect(composerIndex).toBeGreaterThan(taskIndex)
  })

  it('uses one compact conversation menu instead of duplicate selector and history controls', async () => {
    const source = await readFile(path.join(currentDirectory, 'ConversationThread.tsx'), 'utf8')

    expect(source).toContain("aria-label='切换对话'")
    expect(source).toContain('<DropdownMenuContent')
    expect(source).not.toContain("aria-label='查看对话历史'")
    expect(source).not.toContain('<ConversationSidebar')
  })

  it('supports bounded pointer and keyboard resizing without overlaying the preview', async () => {
    const source = await readFile(path.join(currentDirectory, 'ConversationThread.tsx'), 'utf8')

    expect(source).toContain('const CHAT_DOCK_MIN_WIDTH = 360')
    expect(source).toContain('const CHAT_DOCK_MAX_WIDTH = 560')
    expect(source).toContain('const CHAT_DOCK_DEFAULT_WIDTH = 448')
    expect(source).toContain('<motion.hr')
    expect(source).toContain("aria-label='调整对话栏宽度'")
    expect(source).toContain("event.key === 'ArrowLeft'")
    expect(source).toContain("event.key === 'ArrowRight'")
    expect(source).toContain('<motion.section')
    expect(source).toContain('useReducedMotion()')
    expect(source).toContain("className='relative flex min-h-0 shrink-0 flex-col")
  })

  it('separates user requests from document-like Agent replies without turning every message into a card', async () => {
    const source = await readFile(path.join(currentDirectory, 'ConversationThread.tsx'), 'utf8')

    expect(source).toContain('EasyDashboard Agent')
    expect(source).toContain('resolveConversationTimelineItems(conversation)')
    expect(source).toContain('data-agent-activity={activity.type}')
    expect(source).toContain('rounded-[9px_9px_3px_9px]')
    expect(source).toContain("className='space-y-6 px-5 py-6'")
    expect(source).not.toContain("className='divide-y divide-[var(--ed-line)]'")
    expect(source).toContain('EMPTY_PROMPTS.map(prompt =>')
  })
})
