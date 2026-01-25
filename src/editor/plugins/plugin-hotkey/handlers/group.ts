import type { Project } from '@easy-editor/core'

export const createGroupHandlers = (project: Project) => ({
  group: () => {
    const doc = project.currentDocument
    const selection = project.designer.selection
    if (!doc) return

    const selected = selection.getTopNodes(false)
    if (!selected || selected.length < 2) return

    // 传入 ID 数组而不是 Node 数组（DashboardPlugin 的 group 方法需要 string[]）
    const groupNode = (doc as any).group(selected.map(n => n.id))
    if (groupNode) {
      selection.select(groupNode.id)
    }
  },

  ungroup: () => {
    const doc = project.currentDocument
    const selection = project.designer.selection
    if (!doc) return

    const selected = selection.getTopNodes(false)
    if (!selected?.length) return

    for (const node of selected) {
      if (node.isGroup) {
        ;(doc as any).ungroup(node)
      }
    }
    selection.clear()
  },
})
