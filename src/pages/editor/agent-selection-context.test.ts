import { describe, expect, it } from 'vitest'
import { buildEditorAgentSelectionContext } from './agent-selection-context'

describe('editor Agent selection context', () => {
  it('describes the current page, top-level selected nodes, and dashboard viewport', () => {
    const selectedNodes = [
      { id: 'chart-1', title: '营业收入趋势', componentName: 'LineChart' },
      { id: 'group-1', title: '核心竞争力', componentName: 'Div' },
    ]
    const source = {
      currentDocument: {
        id: 'page-document-1',
        fileName: 'bank-report',
        rootNode: {
          getExtraProp: () => ({ getAsString: () => '银行财报' }),
          getDashboardRect: () => ({ width: 1920, height: 1080 }),
        },
      },
      designer: { selection: { getTopNodes: () => selectedNodes } },
      simulator: { deviceStyle: { viewport: { width: 1600, height: 900 } } },
    }

    expect(buildEditorAgentSelectionContext(source)).toEqual({
      pageId: 'page-document-1',
      pageLabel: '银行财报',
      selectedRefs: selectedNodes,
      viewport: { width: 1920, height: 1080 },
    })
    expect(source.designer.selection.getTopNodes()).toBe(selectedNodes)
  })

  it('falls back to the file name and device viewport when dashboard metadata is absent', () => {
    const source = {
      currentDocument: {
        id: 'page-2',
        fileName: 'overview',
        rootNode: null,
      },
      designer: { selection: { getTopNodes: () => [] } },
      simulator: { deviceStyle: { viewport: { width: 1280, height: 720 } } },
    }

    expect(buildEditorAgentSelectionContext(source)).toEqual({
      pageId: 'page-2',
      pageLabel: 'overview',
      selectedRefs: [],
      viewport: { width: 1280, height: 720 },
    })
  })

  it('returns undefined when there is no current editor document', () => {
    expect(
      buildEditorAgentSelectionContext({
        currentDocument: null,
        designer: { selection: { getTopNodes: () => [] } },
      }),
    ).toBeUndefined()
  })
})
