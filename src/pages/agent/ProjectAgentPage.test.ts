import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

describe('project Agent workspace source contract', () => {
  it('connects private conversations, visible tasks, context, planning, and the real project preview', async () => {
    const source = await readFile(path.join(currentDirectory, 'ProjectAgentPage.tsx'), 'utf8')

    expect(source).toContain('<ConversationThread')
    expect(source).toContain('<ProjectSchemaRenderer')
    expect(source).toContain('<ProjectContextSheet')
    expect(source).toContain('await startAgentRun({')
    expect(source).toContain('await respondAgentTask({')
    expect(source).toContain('questionId: pendingQuestion.id, turnId: userTurn.id')
    expect(source).toContain('recordAgentRunPendingQuestion({')
    expect(source).toContain('attachmentIds: requestAttachments.flatMap')
    expect(source).toContain('await pollAgentRun(projectId, run)')
    expect(source).toContain('await resumeAgentRun(activeConversation, task)')
    expect(source).toContain("['planning', 'running', 'prepared'].includes(task.run.status)")
    expect(source).toContain('不会重复启动')
    expect(source).toContain('const retryConversation = appendAgentTurn({')
    expect(source).toContain('const retryTask = retryConversation.tasks.at(-1)')
    expect(source).toContain('message.attachments, retryTask.id)')
    expect(source).not.toContain('message.attachments, task.id)\n  }, [activeConversation')
    expect(source).toContain('connectAgentWorkspaceSync({')
    expect(source).toContain('await uploadAgentFiles(projectId, conversation.id, files)')
    expect(source).toContain('getProjectAttachmentManifest(user.id, projectId)')
    expect(source).toContain('const confirmedContexts = await refreshSharedContexts()')
    expect(source).toContain('sourceTaskId: pending.sourceTaskId')
    expect(source).toContain('provenance: pending.provenance')
    expect(source).toContain('deleteProjectContext(user.id, projectId, pending.id)')
    expect(source).toContain('expectedRevision: shared.revision')
    expect(source).toContain('showTaskProgress={agentPreferences.showTaskProgress}')
    expect(source).toContain('recordAgentRun({')
    expect(source).toContain("run.status === 'committed'")
    expect(source.match(/await refreshProjectDraft\('提交'\)/g)).toHaveLength(3)
    expect(source.match(/await refreshProjectDraft\('回滚'\)/g)).toHaveLength(1)
    expect(source).toContain("recoveredCommittedRun ||= run.status === 'committed'")
    expect(source).toContain('publishUpdate: publishProjectDraftUpdate')
    expect(source).toContain('草稿${mutationLabel}已完成，但当前画布未能刷新')
    expect(source).toContain("createContextProposal(prompt, run.message ?? '', taskId)")
    expect(source).toContain('buildProjectMemoryProposal({ sourceTaskId: taskId')
    expect(source).not.toContain('真实执行 ${run.operationId} 已提交')
    expect(source).toContain('重试当前阶段')
    expect(source).toContain('重试保存上下文')
  })

  it('replays every missing terminal Agent reply when a conversation is reopened', async () => {
    const source = await readFile(path.join(currentDirectory, 'ProjectAgentPage.tsx'), 'utf8')

    expect(source).toContain('const terminalTasksMissingReplies = activeConversation.tasks.filter')
    expect(source).toContain("['committed', 'stale', 'failed', 'indeterminate'].includes(task.run.status)")
    expect(source).toContain("message.role === 'assistant' && message.taskId === task.id")
    expect(source).toContain('for (const task of terminalTasksMissingReplies)')
    expect(source).toContain('message: run.message')
    expect(source).toContain('refreshedOperationIdsRef.current.delete(operationId)')
  })

  it('auto-starts a waiting task without depending on mutable progress copy', async () => {
    const source = await readFile(path.join(currentDirectory, 'ProjectAgentPage.tsx'), 'utf8')

    expect(source).toContain("planStage?.status !== 'waiting'")
    expect(source).not.toContain("planStage.detail !== '等待 Agent 执行服务'")
    expect(source).not.toContain("planStage.detail !== '等待 Agent 开始处理'")
  })

  it('uses uncertainty-aware cost formatting in the page and task thread', async () => {
    const taskSource = await readFile(path.join(currentDirectory, 'TaskThread.tsx'), 'utf8')

    expect(taskSource).toContain('formatAgentRunCost(task.run?.cost)')
    expect(taskSource).not.toContain('task.run.cost.amount}')
  })

  it('shows Skill trace only when a run records used skills', async () => {
    const taskSource = await readFile(path.join(currentDirectory, 'TaskThread.tsx'), 'utf8')

    expect(taskSource).toContain('task.run.trace?.skills.length')
    expect(taskSource).toContain('使用技能')
    expect(taskSource).toContain('task.run.trace.skills.map')
  })

  it('keeps manual editing one click away in an immersive project workspace', async () => {
    const source = await readFile(path.join(currentDirectory, 'ProjectAgentPage.tsx'), 'utf8')

    expect(source).toContain('手动编辑')
    expect(source).toContain('editor?conversation=')
    expect(source).toContain("aria-label='返回工作台'")
    expect(source).not.toContain("from '@/layouts/WorkspaceRail'")
    expect(source).not.toContain('<WorkspaceRail />')
    expect(source).not.toContain('overflow-hidden pl-14')
    expect(source).not.toContain('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]')
    expect(source).not.toContain('<ConversationSidebar')
    expect(source).not.toMatch(/\b(Bot|Wand|Sparkles|MagicWand)\b/)
    expect(source).not.toMatch(/purple|violet|fuchsia/)
  })

  it('keeps the live artifact as the largest flexible workspace region', async () => {
    const source = await readFile(path.join(currentDirectory, 'ProjectAgentPage.tsx'), 'utf8')

    expect(source).toContain("aria-label='当前画布'")
    expect(source).toContain("className='relative flex min-w-0 flex-1 flex-col bg-[#030507]'")
    expect(source).toContain('草稿已同步')
    expect(source).toContain('<ConversationThread')
    expect(source).toContain('text-[15px] font-medium leading-5')
  })

  it('keeps passive Agent copy focused on the work instead of canvas dimensions', async () => {
    const threadSource = await readFile(path.join(currentDirectory, 'ConversationThread.tsx'), 'utf8')
    const rendererSource = await readFile(path.join(currentDirectory, '../preview/ProjectSchemaRenderer.tsx'), 'utf8')

    expect(threadSource).toContain('Agent 会理解需求、安排步骤，并把结果直接更新到右侧草稿。')
    expect(threadSource).toContain('描述你想创建或修改的大屏…')
    expect(threadSource).not.toContain('在隔离画布中执行')
    expect(rendererSource).toContain('createDashboardPreviewAriaLabel(project.name)')
    expect(rendererSource).not.toContain('detail={`${viewport.width} × ${viewport.height}`}')
  })

  it('uses Motion for a perceptible one-shot workspace entrance and honors reduced motion', async () => {
    const source = await readFile(path.join(currentDirectory, 'ProjectAgentPage.tsx'), 'utf8')

    expect(source).toContain("from 'motion/react'")
    expect(source).toContain('useReducedMotion()')
    expect(source).toContain('<motion.header')
    expect(source).toContain('<motion.section')
  })
})
