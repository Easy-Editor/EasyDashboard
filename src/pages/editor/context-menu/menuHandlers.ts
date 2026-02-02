import { TRANSFORM_STAGE, insertChildren, project } from '@easy-editor/core'

/**
 * 图层操作处理函数
 */
export const layerHandlers = {
  /** 置顶 */
  top: () => {
    const selected = project.designer.selection.getTopNodes(false)
    if (!selected?.length) return
    for (let i = selected.length - 1; i >= 0; i--) {
      selected[i].levelBottom() // 视觉置顶 = levelBottom
    }
  },

  /** 置底 */
  bottom: () => {
    const selected = project.designer.selection.getTopNodes(false)
    if (!selected?.length) return
    for (let i = selected.length - 1; i >= 0; i--) {
      selected[i].levelTop() // 视觉置底 = levelTop
    }
  },

  /** 上移一层 */
  up: () => {
    const selected = project.designer.selection.getTopNodes(false)
    if (!selected?.length) return
    for (let i = selected.length - 1; i >= 0; i--) {
      const node = selected[i]
      if (node.parent && node.index >= node.parent.childrenNodes.length - 1) continue
      node.levelDown() // 视觉上移 = levelDown
    }
  },

  /** 下移一层 */
  down: () => {
    const selected = project.designer.selection.getTopNodes(false)
    if (!selected?.length) return
    for (let i = selected.length - 1; i >= 0; i--) {
      const node = selected[i]
      if (node.index <= 0) continue
      node.levelUp() // 视觉下移 = levelUp
    }
  },
}

/**
 * 对齐操作处理函数
 */
export const alignHandlers = {
  left: () => project.designer.alignment.alignLeft(),
  right: () => project.designer.alignment.alignRight(),
  top: () => project.designer.alignment.alignTop(),
  bottom: () => project.designer.alignment.alignBottom(),
  horizontalCenter: () => project.designer.alignment.alignHorizontalCenter(),
  verticalCenter: () => project.designer.alignment.alignVerticalCenter(),
  distributeHorizontal: () => project.designer.alignment.distributeHorizontal(),
  distributeVertical: () => project.designer.alignment.distributeVertical(),
}

/**
 * 分组操作处理函数
 */
export const groupHandlers = {
  /** 成组 */
  group: () => {
    const doc = project.currentDocument
    const selection = project.designer.selection
    if (!doc) return
    const selected = selection.getTopNodes(false)
    if (!selected || selected.length < 2) return
    const groupNode = (doc as any).group(selected.map((n: any) => n.id))
    if (groupNode) selection.select(groupNode.id)
  },

  /** 取消成组 */
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
}

/**
 * 剪贴板操作处理函数
 */
export const clipboardHandlers = {
  /** 复制 */
  copy: async () => {
    const selected = project.designer.selection.getTopNodes(false)
    if (!selected?.length) return
    const componentsTree = selected.map(item => item?.export(TRANSFORM_STAGE.CLONE))
    const data = { type: 'NodeSchema', componentsMap: {}, componentsTree }
    await navigator.clipboard.writeText(JSON.stringify(data))
  },

  /** 剪切 */
  cut: async () => {
    const selection = project.designer.selection
    const selected = selection.getTopNodes(false)
    if (!selected?.length) return
    const componentsTree = selected.map(item => item?.export(TRANSFORM_STAGE.CLONE))
    const data = { type: 'NodeSchema', componentsMap: {}, componentsTree }
    await navigator.clipboard.writeText(JSON.stringify(data))
    for (const node of selected) {
      node.remove()
    }
    selection.clear()
  },

  /** 粘贴 */
  paste: async () => {
    const doc = project.currentDocument
    const selection = project.designer.selection
    if (!doc) return
    try {
      const data = JSON.parse(await navigator.clipboard.readText())
      if (data.componentsTree) {
        const nodes = insertChildren(doc.rootNode!, data.componentsTree)
        if (nodes) selection.selectAll(nodes.map(o => o.id))
      }
    } catch {}
  },

  /** 拷贝（复制+粘贴） */
  duplicate: () => {
    const doc = project.currentDocument
    const selection = project.designer.selection
    if (!doc) return
    const selected = selection.getTopNodes(false)
    if (!selected?.length) return
    const newNodesId: string[] = []
    for (const node of selected) {
      const cloneSchema = node.export(TRANSFORM_STAGE.CLONE)
      cloneSchema.$dashboard!.rect!.x = (cloneSchema.$dashboard!.rect!.x ?? 0) + 10
      cloneSchema.$dashboard!.rect!.y = (cloneSchema.$dashboard!.rect!.y ?? 0) + 10
      const newNode = doc.insertNode(node.parent!, cloneSchema, node.index + 1)
      if (newNode) newNodesId.push(newNode.id)
    }
    selection.selectAll(newNodesId)
  },
}

/**
 * 显示/隐藏/锁定操作处理函数
 */
export const visibilityHandlers = {
  /** 显示 */
  show: () => {
    const selected = project.designer.selection.getTopNodes(false)
    if (!selected?.length) return
    for (const node of selected) node.hide(false)
  },

  /** 隐藏 */
  hide: () => {
    const selection = project.designer.selection
    const selected = selection.getTopNodes(false)
    if (!selected?.length) return
    for (const node of selected) node.hide()
    selection.clear()
  },

  /** 解锁 */
  unlock: () => {
    const selection = project.designer.selection
    const selected = selection.getTopNodes(false)
    if (!selected?.length) return
    for (const node of selected) node.lock(false)
    selection.clear()
  },

  /** 锁定 */
  lock: () => {
    const selection = project.designer.selection
    const selected = selection.getTopNodes(false)
    if (!selected?.length) return
    for (const node of selected) node.lock()
    selection.clear()
  },
}

/**
 * 历史记录操作处理函数
 */
export const historyHandlers = {
  /** 撤销 */
  undo: () => {
    project.currentDocument?.history.back()
  },

  /** 重做 */
  redo: () => {
    project.currentDocument?.history.forward()
  },
}

/**
 * 节点操作处理函数
 */
export const nodeHandlers = {
  /** 删除 */
  delete: () => {
    const selection = project.designer.selection
    const selected = selection.getTopNodes(false)
    if (!selected?.length) return
    for (const node of selected) node.remove()
    selection.clear()
  },
}
