import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatProjectTime } from './ProjectCard'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

async function readProjectCardSource(): Promise<string> {
  return readFile(path.join(currentDirectory, 'ProjectCard.tsx'), 'utf8')
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = hex
    .match(/[0-9a-f]{2}/gi)!
    .map(channel => Number.parseInt(channel, 16) / 255)
    .map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('ProjectCard', () => {
  it('keeps the trash restore action directly visible on the card', async () => {
    const source = await readProjectCardSource()
    const actions = source.slice(source.indexOf('const actions ='), source.indexOf("if (view === 'list')"))

    expect(actions).toContain('trashed ? (')
    expect(actions).toContain('onClick={() => onRestore?.(project)}')
    expect(actions).toContain('恢复')
    expect(actions).not.toMatch(/DropdownMenuItem[\s\S]*onRestore/)
  })

  it('keeps status out of the crowded title row', async () => {
    const source = await readProjectCardSource()
    const projectMeta = source.slice(source.indexOf('const projectMeta ='), source.indexOf('const actions ='))
    const titleRow = projectMeta.slice(projectMeta.indexOf('<div'), projectMeta.indexOf('</div>') + 6)

    expect(titleRow).not.toContain('已发布')
    expect(projectMeta).toContain("project.state === 'published' ? '已发布' : '草稿'")
  })

  it('formats recent project activity compactly', () => {
    const now = Date.now()

    expect(formatProjectTime(new Date(now - 30_000).toISOString())).toBe('刚刚')
    expect(formatProjectTime(new Date(now + 5 * 60_000).toISOString())).toBe('刚刚')
    expect(formatProjectTime(new Date(now - 12 * 60_000).toISOString())).toBe('12 分钟前')
    expect(formatProjectTime(new Date(now - 3 * 60 * 60_000).toISOString())).toBe('3 小时前')
  })

  it('keeps shell metadata text readable on raised card surfaces', async () => {
    const stylesheet = await readFile(path.join(currentDirectory, '../../styles/global.css'), 'utf8')
    const token = (name: string) => stylesheet.match(new RegExp(`--${name}: (#[0-9a-f]{6})`, 'i'))?.[1] ?? ''

    expect(contrastRatio(token('ed-ink-muted'), token('ed-panel-raised'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(token('ed-ink-faint'), token('ed-panel-raised'))).toBeGreaterThanOrEqual(4.5)
  })
})
