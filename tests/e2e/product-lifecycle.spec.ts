import { type Page, expect, test } from '@playwright/test'

const editorTools = ['大纲', '页面', '组件', '方法状态', '数据源', '素材', '外观', '封面', '版本记录']
const appOrigin = process.env.PLAYWRIGHT_APP_ORIGIN ?? 'http://127.0.0.1:5173'

let createdProjectId: string | null = null

async function permanentlyDeleteProject(page: Page, projectId: string) {
  if (new URL(page.url()).origin !== appOrigin) {
    await page.goto(`${appOrigin}/projects`)
  }

  const deleteThroughBrowser = (path: string) =>
    page.evaluate(async requestPath => {
      const response = await fetch(requestPath, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': '1',
        },
        credentials: 'same-origin',
      })
      return response.status
    }, path)

  const trashStatus = await deleteThroughBrowser(`/api/projects/${encodeURIComponent(projectId)}`)
  expect([204, 404], 'E2E 清理应能将测试项目移入回收站或确认它已不在活动项目中').toContain(trashStatus)

  const deleteStatus = await deleteThroughBrowser(`/api/projects/${encodeURIComponent(projectId)}/permanent`)
  expect([204, 404], 'E2E 清理应能永久删除测试项目或确认其已不存在').toContain(deleteStatus)
}

function publicationApiUrl(viewerUrl: string): string {
  const pathname = new URL(viewerUrl).pathname.replace(/^\/view\//, '/api/public/projects/')
  return new URL(pathname, appOrigin).toString()
}

test.afterEach(async ({ page }) => {
  if (!createdProjectId) return
  await permanentlyDeleteProject(page, createdProjectId)
  createdProjectId = null
})

test('个人大屏从注册到发布、下线和永久删除形成完整闭环', async ({ context, page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `e2e-${runId}@example.com`
  const password = `EasyDashboard-${runId}-Aa!`
  const projectName = `E2E 大屏 ${runId}`

  await test.step('未登录访问项目时引导登录和注册', async () => {
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: '登录工作台' })).toBeVisible()

    await page.getByRole('link', { name: '创建账户' }).click()
    await expect(page).toHaveURL(/\/signup$/)
    await expect(page.getByRole('heading', { name: '创建工作区账户' })).toBeVisible()

    await page.getByLabel('邮箱').fill(email)
    await page.getByLabel('密码').fill(password)
    await page.getByRole('button', { name: '创建账户' }).click()

    const projectsLink = page.getByRole('link', { name: '所有项目' })
    await expect(projectsLink).toBeVisible()
    await projectsLink.click()
    await expect(page).toHaveURL(/\/projects$/)
  })

  await test.step('注册后的账户可以退出并重新登录', async () => {
    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await page.getByLabel('邮箱').fill(email)
    await page.getByLabel('密码').fill(password)
    await page.getByRole('button', { name: '登录' }).click()
    const projectsLink = page.getByRole('link', { name: '所有项目' })
    await expect(projectsLink).toBeVisible()
    await projectsLink.click()
    await expect(page).toHaveURL(/\/projects$/)
  })

  await test.step('通过项目对话框创建大屏并进入编辑器', async () => {
    await page.getByRole('button', { name: '新建项目' }).click()
    const dialog = page.getByRole('dialog', { name: '新建项目' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('项目名称').fill(projectName)
    await dialog.getByLabel('说明').fill('Playwright 产品闭环回归项目')
    await dialog.getByRole('button', { name: '创建并打开' }).click()

    await expect(page).toHaveURL(/\/projects\/[^/]+\/editor(?:\?.*)?$/)
    const match = new URL(page.url()).pathname.match(/^\/projects\/([^/]+)\/editor$/)
    expect(match, '编辑器 URL 应包含新建项目 ID').not.toBeNull()
    createdProjectId = match?.[1] ?? null
    expect(createdProjectId).not.toBeNull()
  })

  const canvas = page.getByRole('region', { name: '项目画布' })

  await test.step('编辑器首次进入及刷新后都恢复画布', async () => {
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveAttribute('data-state', 'ready')

    await page.reload()

    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveAttribute('data-state', 'ready')
    await expect(page).toHaveURL(/\/projects\/[^/]+\/editor\?page=page-home$/)
  })

  await test.step('九个左侧工具逐个打开且不触发 pageerror', async () => {
    const pageErrors: string[] = []
    const recordPageError = (error: Error) => pageErrors.push(error.stack ?? error.message)
    page.on('pageerror', recordPageError)

    for (const tool of editorTools) {
      const button = page.getByRole('button', { name: tool, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('heading', { name: tool, exact: true })).toBeVisible()
      await expect(canvas).toBeVisible()
    }

    page.off('pageerror', recordPageError)
    expect(pageErrors, `工具切换产生浏览器异常：\n${pageErrors.join('\n\n')}`).toEqual([])
  })

  await test.step('草稿预览在新标签页打开且不离开编辑器', async () => {
    const previewPromise = context.waitForEvent('page')
    await page.getByRole('button', { name: '预览草稿' }).click()
    const previewPage = await previewPromise

    try {
      await previewPage.waitForURL(/\/projects\/[^/]+\/preview\?page=page-home$/)
      await expect(previewPage.getByRole('main', { name: new RegExp(`^${projectName} 预览`) })).toBeVisible()
      await expect(page).toHaveURL(/\/projects\/[^/]+\/editor\?page=page-home$/)
    } finally {
      await previewPage.close()
    }
  })

  let stableUrl = ''
  let firstVersionUrl = ''
  let latestVersionUrl = ''

  await test.step('连续发布后稳定链接指向最新版本且不可变版本均可访问', async () => {
    await page.getByRole('button', { name: '发布与分享' }).click()
    const publishDialog = page.getByRole('dialog', { name: '发布与分享' })
    await expect(publishDialog).toBeVisible()
    await publishDialog.getByRole('button', { name: '发布当前草稿' }).click()

    const links = publishDialog.getByRole('region', { name: `${projectName} 的公开链接` })
    await expect(links.getByText('已公开', { exact: true })).toBeVisible()
    const urlRows = links.locator('p[title^="http"]')
    await expect(urlRows).toHaveCount(2)
    stableUrl = (await urlRows.nth(0).getAttribute('title')) ?? ''
    firstVersionUrl = (await urlRows.nth(1).getAttribute('title')) ?? ''
    expect(stableUrl).toMatch(/\/view\/[^/]+$/)
    expect(firstVersionUrl).toMatch(/\/view\/[^/]+\/versions\/\d+$/)

    await publishDialog.getByRole('button', { name: '发布新版本' }).click()
    await expect(urlRows.nth(1)).not.toHaveAttribute('title', firstVersionUrl)
    expect(await urlRows.nth(0).getAttribute('title')).toBe(stableUrl)
    latestVersionUrl = (await urlRows.nth(1).getAttribute('title')) ?? ''
    expect(latestVersionUrl).toMatch(/\/view\/[^/]+\/versions\/\d+$/)
    expect(latestVersionUrl).not.toBe(firstVersionUrl)

    const firstReleaseNumber = Number(new URL(firstVersionUrl).pathname.split('/').at(-1))
    const latestReleaseNumber = Number(new URL(latestVersionUrl).pathname.split('/').at(-1))
    expect(firstReleaseNumber).toBeGreaterThan(0)
    expect(latestReleaseNumber).toBe(firstReleaseNumber + 1)

    for (const [url, expectedReleaseNumber] of [
      [stableUrl, latestReleaseNumber],
      [firstVersionUrl, firstReleaseNumber],
      [latestVersionUrl, latestReleaseNumber],
    ] as const) {
      const apiResponse = await context.request.get(publicationApiUrl(url))
      expect(apiResponse.status()).toBe(200)
      const payload = (await apiResponse.json()) as { project: { releaseNumber: number } }
      expect(payload.project.releaseNumber).toBe(expectedReleaseNumber)

      const publishedPage = await context.newPage()
      try {
        const response = await publishedPage.goto(url)
        expect(response?.status()).toBe(200)
        await expect(publishedPage.getByRole('main', { name: new RegExp(`^${projectName} 预览`) })).toBeVisible()
      } finally {
        await publishedPage.close()
      }
    }
  })

  await test.step('取消发布后稳定链接和所有版本链接都返回真实 404', async () => {
    const publishDialog = page.getByRole('dialog', { name: '发布与分享' })
    if (!(await publishDialog.isVisible())) {
      await page.getByRole('button', { name: '发布与分享' }).click()
      await expect(publishDialog).toBeVisible()
    }
    await publishDialog.getByRole('button', { name: '取消发布' }).click()

    const confirmation = page.getByRole('alertdialog', { name: '确认取消发布？' })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: '取消发布并使链接失效' }).click()
    await expect(publishDialog.getByRole('button', { name: '发布当前草稿' })).toBeVisible()

    for (const url of [stableUrl, firstVersionUrl, latestVersionUrl]) {
      await expect
        .poll(async () => (await context.request.get(url)).status(), {
          message: `${url} 应在取消发布后返回 404`,
        })
        .toBe(404)
    }

    const unavailablePage = await context.newPage()
    try {
      const response = await unavailablePage.goto(stableUrl)
      expect(response?.status()).toBe(404)
      await expect(unavailablePage.getByText('发布地址不存在')).toBeVisible()
    } finally {
      await unavailablePage.close()
    }

    await page.keyboard.press('Escape')
    await expect(publishDialog).toBeHidden()
  })

  await test.step('项目可移入回收站并通过名称确认永久删除', async () => {
    await page.goto('/projects')
    await expect(page.getByRole('heading', { name: '所有项目' })).toBeVisible()

    await page.getByRole('button', { name: `${projectName}更多操作` }).click()
    await page.getByRole('menuitem', { name: '移入回收站' }).click()
    await expect(page.getByRole('heading', { name: projectName })).toBeHidden()

    await page.getByRole('link', { name: '回收站' }).click()
    await expect(page).toHaveURL(/\/trash$/)
    await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()

    await page.getByRole('button', { name: `永久删除 ${projectName}` }).click()
    const deleteDialog = page.getByRole('dialog', { name: `永久删除“${projectName}”？` })
    await deleteDialog.getByLabel(`输入项目名称“${projectName}”确认`).fill(projectName)
    await deleteDialog.getByRole('button', { name: '永久删除' }).click()
    await expect(page.getByText(`“${projectName}”已永久删除`)).toBeVisible()
  })
})
