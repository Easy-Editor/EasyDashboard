import type { Project } from '@easy-editor/core'

export const createLayerHandlers = (project: Project) => {
  const getSelectedNodes = () => {
    const selection = project.designer.selection
    return selection.getTopNodes(false) ?? []
  }

  return {
    // 置顶（视觉上最上层）- 使用 levelBottom 因为它移动到最大 index
    layerTop: () => {
      const selected = getSelectedNodes()
      if (!selected.length) return

      for (let i = selected.length - 1; i >= 0; i--) {
        selected[i].levelBottom()
      }
    },

    // 置底（视觉上最下层）- 使用 levelTop 因为它移动到 index 0
    layerBottom: () => {
      const selected = getSelectedNodes()
      if (!selected.length) return

      for (let i = selected.length - 1; i >= 0; i--) {
        selected[i].levelTop()
      }
    },

    // 上移一层（视觉上向上）- 使用 levelDown 因为它增加 index
    layerUp: () => {
      const selected = getSelectedNodes()
      if (!selected.length) return

      for (let i = selected.length - 1; i >= 0; i--) {
        const node = selected[i]
        const parent = node.parent
        // 边界检查：已经在最顶层则不操作
        if (parent && node.index >= parent.childrenNodes.length - 1) continue
        node.levelDown()
      }
    },

    // 下移一层（视觉上向下）- 使用 levelUp 因为它减少 index
    layerDown: () => {
      const selected = getSelectedNodes()
      if (!selected.length) return

      for (let i = selected.length - 1; i >= 0; i--) {
        const node = selected[i]
        // 边界检查：已经在最底层则不操作
        if (node.index <= 0) continue
        node.levelUp()
      }
    },
  }
}
