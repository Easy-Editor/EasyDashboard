import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectSummary } from '@/api/contracts'
import { describe, expect, it } from 'vitest'

import { formatPublishedProjectActivity, selectRecentDesigns, selectRecentPublications } from './HomePage'

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
    expect(source).toContain('最近设计和发布记录尚未更新')
    expect(source).not.toContain('.catch(() => setProjects([]))')
  })

  it('keeps settings failure non-blocking while exposing a retry', async () => {
    const source = await readFile(path.join(currentDirectory, 'HomePage.tsx'), 'utf8')

    expect(source).toContain("setSettingsLoadError('个人称呼读取失败，当前使用账号称呼。')")
    expect(source).toContain('onClick={() => void loadSettings()}')
    expect(source).toContain("<output className='text-xs text-[#e8c477]'>")
  })
})
