import type { Project } from '@easy-editor/core'

export const createVisibilityHandlers = (project: Project) => {
  const getSelectedNodes = () => {
    const selection = project.designer.selection
    return selection.getTopNodes(false) ?? []
  }

  return {
    toggleLock: () => {
      const nodes = getSelectedNodes()
      if (!nodes.length) return

      const selection = project.designer.selection
      for (const node of nodes) {
        node.lock(!node.isLocked)
      }
      selection.clear()
    },

    toggleVisibility: () => {
      const nodes = getSelectedNodes()
      if (!nodes.length) return

      const selection = project.designer.selection
      for (const node of nodes) {
        node.hide(!node.isHidden)
      }
      selection.clear()
    },
  }
}
