import type { Project } from '@easy-editor/core'

export const createSelectionHandlers = (project: Project) => ({
  selectAll: () => {
    const doc = project.currentDocument
    if (!doc?.rootNode) return

    const allNodeIds = doc.rootNode.childrenNodes?.map(node => node.id) ?? []
    if (allNodeIds.length) {
      project.designer.selection.selectAll(allNodeIds)
    }
  },

  clearSelection: () => {
    project.designer.selection.clear()
  },

  delete: () => {
    const doc = project.currentDocument
    const selection = project.designer.selection
    if (!doc) return

    const nodes = selection.getTopNodes()
    for (const node of nodes) {
      node && doc.removeNode(node)
    }
    selection.clear()
  },
})
