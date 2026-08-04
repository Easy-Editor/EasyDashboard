import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectSummary } from '@/api/contracts'
import { describe, expect, it } from 'vitest'

import {
  deriveAgentProjectName,
  formatPublishedProjectActivity,
  resolveRecentProjectTarget,
  selectRecentDesigns,
  selectRecentPublications,
} from './HomePage'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

function project(overrides: Partial<ProjectSummary>): ProjectSummary {
  return {
    id: 'project-1',
    name: '运营大屏',
    description: '',
    slug: null,
    state: 'draft',
    draftVersion: 1,
    resolution: { width: 1920, height: 1080 },
    pageCount: 1,
    startPageId: 'page-home',
    isFavorite: false,
    thumbnail: {
      mode: 'auto',
      status: 'queued',
      url: null,
      draftVersion: null,
      errorCode: null,
    },
    savedAt: '2026-07-30T02:00:00.000Z',
    publishedAt: null,
    currentReleaseNumber: null,
    deletedAt: null,
    updatedAt: '2026-07-30T02:00:00.000Z',
    ...overrides,
  }
}

describe('HomePage project timelines', () => {
  it('derives a compact project name from the first Agent request', () => {
    expect(deriveAgentProjectName('帮我创建一块城市低空运行态势大屏，突出告警和航线')).toBe(
      '一块城市低空运行态势大屏 突出告警和航线',
    )
    expect(deriveAgentProjectName('   ')).toBe('未命名大屏')
  })

  it('orders recent designs by the server-confirmed draft save time', () => {
    const projects = [
      project({
        id: 'older-draft',
        savedAt: '2026-07-30T02:00:00.000Z',
        updatedAt: '2026-07-30T08:00:00.000Z',
      }),
      project({
        id: 'newer-draft',
        savedAt: '2026-07-30T06:00:00.000Z',
        updatedAt: '2026-07-30T01:00:00.000Z',
      }),
    ]

    expect(selectRecentDesigns(projects).map(item => item.id)).toEqual(['newer-draft', 'older-draft'])
  })

  it('opens the latest local Agent conversation for the featured project when one exists', () => {
    expect(
      resolveRecentProjectTarget('project-1', [
        { id: 'other-latest', projectId: 'project-2', updatedAt: '2026-07-30T09:00:00.000Z' },
        { id: 'older-match', projectId: 'project-1', updatedAt: '2026-07-30T05:00:00.000Z' },
        { id: 'latest-match', projectId: 'project-1', updatedAt: '2026-07-30T08:00:00.000Z' },
      ]),
    ).toBe('/projects/project-1/agent/latest-match')
    expect(resolveRecentProjectTarget('project-1', [])).toBe('/projects/project-1/agent')
  })

  it('orders published projects by publication time rather than draft updates', () => {
    const projects = [
      project({
        id: 'older-release',
        state: 'published',
        publishedAt: '2026-07-29T02:00:00.000Z',
        updatedAt: '2026-07-30T09:00:00.000Z',
      }),
      project({
        id: 'newer-release',
        state: 'published',
        publishedAt: '2026-07-30T06:00:00.000Z',
        updatedAt: '2026-07-29T01:00:00.000Z',
      }),
      project({ id: 'draft-only' }),
    ]

    expect(selectRecentPublications(projects).map(item => item.id)).toEqual(['newer-release', 'older-release'])
  })

  it('labels the current release and handles publication metadata still being synchronized', () => {
    expect(
      formatPublishedProjectActivity(
        project({
          state: 'published',
          publishedAt: '2026-07-30T06:00:00.000Z',
          currentReleaseNumber: 4,
        }),
      ),
    ).toContain('版本 4 · 发布于')
    expect(formatPublishedProjectActivity(project({ state: 'published' }))).toBe('发布版本待同步 · 发布时间待同步')
  })

  it('does not turn a failed project request into truthful-looking empty sections', async () => {
    const source = await readFile(path.join(currentDirectory, 'HomePage.tsx'), 'utf8')

    expect(source).toContain('{projectLoadError ? (')
    expect(source).toContain('最近项目暂时没有更新')
    expect(source).not.toContain('.catch(() => setProjects([]))')
  })

  it('keeps settings failure non-blocking while exposing a retry', async () => {
    const source = await readFile(path.join(currentDirectory, 'HomePage.tsx'), 'utf8')

    expect(source).toContain("setSettingsLoadError('个人设置读取失败，当前使用默认配置。')")
    expect(source).toContain('onClick={() => void loadSettings()}')
    expect(source).toContain("<output className='text-xs text-[#e8c477]'>")
  })

  it('promises only attachment formats accepted by the upload backend', async () => {
    const source = await readFile(path.join(currentDirectory, 'HomePage.tsx'), 'utf8')

    expect(source).toContain('AGENT_ATTACHMENT_ACCEPT')
    expect(source).toContain('AGENT_ATTACHMENT_FORMAT_LABEL')
    expect(source).not.toContain("accept='image/*,.pdf,.csv,.xlsx,.xls,.doc,.docx,.txt,.json'")
  })

  it('uses a narrow single-axis workspace with projects before conversations', async () => {
    const source = await readFile(path.join(currentDirectory, 'HomePage.tsx'), 'utf8')

    expect(source).toContain("data-home-launcher='primary'")
    expect(source).toContain('从这里开始你的下一块大屏')
    expect(source).toContain('ed-home-primary mx-auto w-full max-w-[820px]')
    expect(source).toContain('pt-[clamp(180px,28vh,300px)]')
    expect(source).toContain("className='ed-home-recent-projects'")
    expect(source).toContain("className='ed-home-recent-conversations'")
    expect(source).toContain('max-w-[660px]')
    expect(source).toContain("className='aspect-[2.1]'")
    expect(source).toContain('添加附件')
    expect(source).toContain('onClick={openAttachmentPicker}')
    expect(source).not.toContain('AGENT_REFERENCE_ATTACHMENT_ACCEPT')
    expect(source).not.toContain('AGENT_DATA_ATTACHMENT_ACCEPT')
    expect(source).not.toContain('新附件可见范围')
    expect(source).not.toContain('CANVAS_RESOLUTION_PRESETS')
    expect(source).toContain("aria-labelledby='recent-projects-title'")
    expect(source).toContain("aria-labelledby='recent-conversations-title'")
    expect(source).toContain('最近项目')
    expect(source).toContain('最近对话')
    expect(source).toContain("to='/projects'")
    expect(source).toContain('recentDesigns.slice(0, 3).map')
    expect(source).toContain('recentConversations.slice(0, 4).map')
    expect(source.indexOf("aria-labelledby='recent-projects-title'")).toBeLessThan(
      source.indexOf("aria-labelledby='recent-conversations-title'"),
    )
    expect(source).not.toContain('projectById')
    expect(source).not.toContain('conversation.messages.at(-1)')
    expect(source).not.toContain('<HomeLaunchCore')
    expect(source).not.toContain('starterPrompts')
    expect(source).not.toContain("eyebrow='Workspace / Agent'")
    expect(source).not.toContain('可以这样开始')
  })

  it('keeps resolution out of the simplified homepage and passive project summaries', async () => {
    const homeSource = await readFile(path.join(currentDirectory, 'HomePage.tsx'), 'utf8')
    const thumbnailSource = await readFile(
      path.join(currentDirectory, '../../components/project/ProjectThumbnail.tsx'),
      'utf8',
    )
    const authSource = await readFile(path.join(currentDirectory, '../../layouts/AuthLayout.tsx'), 'utf8')
    const templatesSource = await readFile(path.join(currentDirectory, '../templates/TemplatesPage.tsx'), 'utf8')

    expect(homeSource).not.toContain('初始画布分辨率')
    expect(homeSource).not.toContain('resolutionPreset')
    expect(homeSource).toContain('structuredClone(defaultProjectSchema)')
    expect(thumbnailSource).not.toContain('project.resolution')
    expect(authSource).not.toContain('ed-auth-core-resolution')
    expect(templatesSource).not.toContain('template.resolution')
  })

  it('does not merge project and conversation histories into an ambiguous work list', async () => {
    const source = await readFile(path.join(currentDirectory, 'HomePage.tsx'), 'utf8')

    expect(source).not.toContain('const recentWork = useMemo')
    expect(source).not.toContain('additionalRecentWork')
    expect(source).not.toContain('更多最近工作')
  })

  it('pauses attachment-backed starts and retries uploads without creating another project', async () => {
    const source = await readFile(path.join(currentDirectory, 'HomePage.tsx'), 'utf8')

    expect(source).toContain('let started = pendingStart')
    expect(source).toContain('startIdempotencyKeyRef.current ?? crypto.randomUUID()')
    expect(source).toContain('idempotencyKey: attachment.id')
    expect(source).toContain('if (!started) {')
    expect(source).toContain('uploadedAttachmentsRef.current.get(attachment.id)')
    expect(source).toContain("detail: '等待 Agent 执行服务'")
    expect(source).toContain('const attachmentSync = await syncAgentWorkspaceProject')
    expect(source).toContain("if (attachmentSync.status === 'local-offline')")
    expect(source).toContain('await finalizeAgentStartAttachments(started.project.id, started.run.operationId)')
    expect(source.indexOf('setAgentMessageAttachments({')).toBeLessThan(
      source.indexOf('const attachmentSync = await syncAgentWorkspaceProject'),
    )
    expect(source.indexOf('const attachmentSync = await syncAgentWorkspaceProject')).toBeLessThan(
      source.indexOf('await finalizeAgentStartAttachments(started.project.id, started.run.operationId)'),
    )
    expect(source).not.toContain("controlAgentRun(started.project.id, started.run.operationId, 'resume')")
    expect(source).toContain('请在此重试，不会重复创建项目。')
    expect(source).not.toContain('项目已创建，但附件上传失败')
  })
})
