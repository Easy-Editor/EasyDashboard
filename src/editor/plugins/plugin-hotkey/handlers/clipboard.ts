import { type Project, TRANSFORM_STAGE, clipboard, insertChildren } from '@easy-editor/core'

const DUPLICATE_OFFSET = 10

export const createClipboardHandlers = (project: Project) => {
  // 粘贴节点的通用函数
  const pasteNodes = (componentsTree: any[]) => {
    const doc = project.currentDocument
    const selection = project.designer.selection
    if (!doc) return

    const target = doc.rootNode
    if (!target) return

    const nodes = insertChildren(target, componentsTree)
    if (nodes) {
      selection.selectAll(nodes.map(n => n.id))
    }
  }

  return {
    copy: () => {
      const doc = project.currentDocument
      if (!doc) return

      const selected = project.designer.selection.getTopNodes(false)
      if (!selected?.length) return

      const componentsTree = selected.map(item => item?.export(TRANSFORM_STAGE.CLONE))
      const data = { type: 'NodeSchema', componentsMap: {}, componentsTree }
      clipboard.setData(data)
    },

    cut: () => {
      const doc = project.currentDocument
      if (!doc) return

      const selection = project.designer.selection
      const selected = selection.getTopNodes(false)
      if (!selected?.length) return

      const componentsTree = selected.map(item => item?.export(TRANSFORM_STAGE.CLONE))
      const data = { type: 'NodeSchema', componentsMap: {}, componentsTree }
      clipboard.setData(data)

      for (const node of selected) {
        node?.parent?.select()
        node.remove()
      }
      selection.clear()
    },

    paste: (e: KeyboardEvent) => {
      clipboard.waitPasteData(e, ({ componentsTree }) => {
        if (componentsTree) {
          pasteNodes(componentsTree)
        }
      })
    },

    duplicate: () => {
      const doc = project.currentDocument
      const selection = project.designer.selection
      if (!doc) return

      const selected = selection.getTopNodes(false)
      if (!selected?.length) return

      const newNodesId: string[] = []
      for (const node of selected) {
        const cloneSchema = node.export(TRANSFORM_STAGE.CLONE)
        if (cloneSchema.$dashboard?.rect) {
          cloneSchema.$dashboard.rect.x = (cloneSchema.$dashboard.rect.x ?? 0) + DUPLICATE_OFFSET
          cloneSchema.$dashboard.rect.y = (cloneSchema.$dashboard.rect.y ?? 0) + DUPLICATE_OFFSET
        }
        const newNode = doc.insertNode(node.parent!, cloneSchema, node.index + 1)
        if (newNode) {
          newNodesId.push(newNode.id)
        }
      }
      selection.selectAll(newNodesId)
    },
  }
}
