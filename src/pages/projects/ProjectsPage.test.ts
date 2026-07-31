import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectSummary } from '@/api/contracts'
import { describe, expect, it } from 'vitest'

import { describeEmptyProjectFilter, filterAndSortProjects, normalizeProjectSearchTerm } from './ProjectsPage'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

function project(overrides: Partial<ProjectSummary>): ProjectSummary {
  return {
    id: 'project-1',
    name: '城市运营大屏',
    description: '综合态势',
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

describe('ProjectsPage filtering', () => {
  it('normalizes surrounding and repeated whitespace in search terms', () => {
    expect(normalizeProjectSearchTerm('  城市   运营  ')).toBe('城市 运营')
  })

  it('filters case-insensitively and orders favorites before draft save recency', () => {
    const projects = [
      project({ id: 'ordinary-new', name: 'SALES BOARD', savedAt: '2026-07-30T08:00:00.000Z' }),
      project({
        id: 'favorite-old',
        name: 'Sales Overview',
        isFavorite: true,
        savedAt: '2026-07-29T08:00:00.000Z',
      }),
      project({ id: 'unmatched', name: '设备监控' }),
    ]

    expect(filterAndSortProjects(projects, '  sales ', 'all').map(item => item.id)).toEqual([
      'favorite-old',
      'ordinary-new',
    ])
  })

  it('echoes the normalized query and active lifecycle filter in the empty state', () => {
    expect(describeEmptyProjectFilter('  城市   运营  ', 'published')).toBe(
      '未找到名称或说明中包含“城市 运营”的已发布项目。',
    )
    expect(describeEmptyProjectFilter('', 'draft')).toBe('当前没有草稿项目。')
  })

  it('keeps request failures separate from filter and empty states', async () => {
    const source = await readFile(path.join(currentDirectory, 'ProjectsPage.tsx'), 'utf8')

    expect(source).toContain('setProjects(null)')
    expect(source).toContain('{loadError ? null : projects ? (')
  })

  it('describes creation resolution as a per-page starting value with bounded custom dimensions', async () => {
    const source = await readFile(path.join(currentDirectory, 'ProjectsPage.tsx'), 'utf8')

    expect(source).toContain('初始页面分辨率')
    expect(source).toContain('创建后可在编辑器底部为每个页面独立调整。')
    expect(source.match(/max=\{16384\}/g)).toHaveLength(2)
  })
})
