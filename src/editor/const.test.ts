import { describe, expect, it } from 'vitest'

import { defaultProjectSchema } from './const'

describe('defaultProjectSchema', () => {
  it('creates one clean dashboard page without demo behavior or data', () => {
    expect(defaultProjectSchema.componentsTree).toHaveLength(1)

    const [page] = defaultProjectSchema.componentsTree
    expect(page).toMatchObject({
      componentName: 'Root',
      fileName: 'home',
      fileDesc: '首页',
      meta: {
        easyDashboard: {
          pageId: 'page-home',
        },
      },
      $dashboard: {
        rect: {
          width: 1920,
          height: 1080,
        },
      },
      children: [],
    })
    expect(page).not.toHaveProperty('dataSource')
    expect(page).not.toHaveProperty('state')
    expect(page).not.toHaveProperty('lifeCycles')
    expect(page).not.toHaveProperty('methods')
  })

  it('stores the project start page and default visual theme in schema metadata', () => {
    expect(defaultProjectSchema.meta?.easyDashboard).toMatchObject({
      documentVersion: 1,
      startPageId: 'page-home',
      theme: {
        mode: 'dark',
      },
    })
  })
})
