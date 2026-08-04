import { describe, expect, it } from 'vitest'
import {
  LINKED_MATERIALS_ROUTE_PREFIX,
  isLinkedMaterialsRuntimeEnabled,
  resolveLinkedMaterialRequest,
  resolveLinkedMaterialUrl,
} from './linked-materials'

describe('linked materials', () => {
  it('only enables the linked runtime for an explicit development opt-in', () => {
    expect(
      isLinkedMaterialsRuntimeEnabled({
        DEV: true,
        VITE_EASY_DASHBOARD_USE_LINKED_MATERIALS: 'true',
      }),
    ).toBe(true)
    expect(
      isLinkedMaterialsRuntimeEnabled({
        DEV: false,
        VITE_EASY_DASHBOARD_USE_LINKED_MATERIALS: 'true',
      }),
    ).toBe(false)
    expect(
      isLinkedMaterialsRuntimeEnabled({
        DEV: true,
        VITE_EASY_DASHBOARD_USE_LINKED_MATERIALS: 'false',
      }),
    ).toBe(false)
  })

  it('maps only explicitly linked material UMD files to local development routes', () => {
    expect(resolveLinkedMaterialUrl('@easy-editor/materials-dashboard-scroll-list', 'dist/index.min.js', true)).toBe(
      `${LINKED_MATERIALS_ROUTE_PREFIX}/scroll-list/0.0.8/dist/index.min.js`,
    )
    expect(
      resolveLinkedMaterialUrl('@easy-editor/materials-dashboard-scroll-list', 'dist/index.min.esm.js', true),
    ).toBe(undefined)
    expect(resolveLinkedMaterialUrl('@easy-editor/materials-dashboard-text', 'dist/index.min.js', true)).toBe(undefined)
    expect(resolveLinkedMaterialUrl('@easy-editor/materials-dashboard-scroll-list', 'dist/index.min.js', false)).toBe(
      undefined,
    )
    expect(resolveLinkedMaterialUrl('@easy-editor/materials-dashboard-pie-chart', 'dist/component.min.js', true)).toBe(
      `${LINKED_MATERIALS_ROUTE_PREFIX}/pie-chart/0.0.8/dist/component.min.js`,
    )
    expect(
      resolveLinkedMaterialUrl('@easy-editor/materials-dashboard-pie-chart', 'dist/index.min.esm.js', true),
    ).toBeUndefined()
  })

  it('accepts only exact allowlisted routes and rejects traversal attempts', () => {
    expect(
      resolveLinkedMaterialRequest(
        `${LINKED_MATERIALS_ROUTE_PREFIX}/scroll-list/0.0.8/dist/component.min.js?cache=off`,
      ),
    ).toEqual({ material: 'scroll-list', file: 'dist/component.min.js' })

    expect(
      resolveLinkedMaterialRequest(`${LINKED_MATERIALS_ROUTE_PREFIX}/pie-chart/0.0.8/dist/meta.min.js?cache=off`),
    ).toEqual({ material: 'pie-chart', file: 'dist/meta.min.js' })

    expect(
      resolveLinkedMaterialRequest(`${LINKED_MATERIALS_ROUTE_PREFIX}/scroll-list/0.0.8/dist/../../../../package.json`),
    ).toBeUndefined()
    expect(
      resolveLinkedMaterialRequest(`${LINKED_MATERIALS_ROUTE_PREFIX}/scroll-list/0.0.8/dist/%2e%2e/package.json`),
    ).toBeUndefined()
    expect(
      resolveLinkedMaterialRequest(`${LINKED_MATERIALS_ROUTE_PREFIX}/scroll-list/0.0.8/dist/index.min.js/extra`),
    ).toBeUndefined()
    expect(
      resolveLinkedMaterialRequest(`${LINKED_MATERIALS_ROUTE_PREFIX}/scroll-list/0.0.7/dist/index.min.js`),
    ).toBeUndefined()
    expect(
      resolveLinkedMaterialRequest(`${LINKED_MATERIALS_ROUTE_PREFIX}/pie-chart/0.0.7/dist/index.min.js`),
    ).toBeUndefined()
  })
})
