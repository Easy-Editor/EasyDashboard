import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

describe('Agent preference settings', () => {
  it('keeps user preferences private and exposes memory and progress controls', async () => {
    const source = await readFile(path.join(currentDirectory, 'SettingsPage.tsx'), 'utf8')

    expect(source).toContain('个人偏好记忆')
    expect(source).toContain('只属于当前用户，跨项目使用，不会共享给项目成员。')
    expect(source).toContain('rememberProjectContext')
    expect(source).toContain('showTaskProgress')
    expect(source).toContain('defaultAttachmentScope')
  })

  it('exposes explicit model ownership, budget, fallback, and capability controls without echoing a key', async () => {
    const source = await readFile(path.join(currentDirectory, 'SettingsPage.tsx'), 'utf8')

    expect(source).toContain('自定义 OpenAI-compatible')
    expect(source).toContain("type='password'")
    expect(source).toContain('读取时不会回显')
    expect(source).toContain('fallbackToPlatform')
    expect(source).toContain('单任务预算（USD）')
    expect(source).toContain('项目月预算（USD）')
    expect(source).toContain('达到任一预算的 80% 时发出预警。')
    expect(source).toContain('验证三项能力')
    expect(source).toContain('图片理解')
    expect(source).toContain('工具调用')
    expect(source).toContain('结构化输出')
    expect(source).toContain('平台能力已配置')
    expect(source).toContain("agentModelForm.provider === 'platform'")
  })

  it('uses clear Chinese groups with page navigation and a page-level save action', async () => {
    const source = await readFile(path.join(currentDirectory, 'SettingsPage.tsx'), 'utf8')

    expect(source).toContain('grid-cols-[168px_minmax(0,760px)]')
    expect(source).toContain("aria-label='设置分区'")
    expect(source).toContain("id='personal-settings-form'")
    expect(source).toContain("form='personal-settings-form'")
    expect(source).toContain("id='settings-profile'")
    expect(source).toContain("id='settings-agent-model'")
    expect(source).toContain("aria-labelledby='settings-profile-title'")
    expect(source).toContain("aria-labelledby='settings-account-title'")
    expect(source).not.toMatch(/0[1-6] \/ (Profile|Editor|Agent|Model|Security|Account)/)
    expect(source).not.toContain("eyebrow='System / Settings'")
  })

  it('lets the user choose a fixed or space-free workspace rail', async () => {
    const source = await readFile(path.join(currentDirectory, 'SettingsPage.tsx'), 'utf8')

    expect(source).toContain('工作区偏好')
    expect(source).toContain('固定侧边栏')
    expect(source).toContain("workspaceRailPreference: checked ? 'docked' : 'collapsed'")
    expect(source).toContain('publishWorkspaceRailPreference(normalizedSettings.workspaceRailPreference, user?.id)')
    expect(source).not.toContain("workspaceRailPreference: 'overlay'")
  })
})
