import type { Document, Node, Project } from '@easy-editor/core'

export function bindProjectMutations(project: Project, onMutation: () => void): () => void {
  const documentDisposers = new Map<string, () => void>()
  let disposed = false

  const bindDocument = (document: Document) => {
    if (disposed || documentDisposers.has(document.id)) return

    const nodeBindings = new Map<string, { node: Node; dispose: () => void }>()
    let documentDisposed = false

    const bindNode = (node: Node) => {
      const existingBinding = nodeBindings.get(node.id)
      if (existingBinding?.node === node) return
      existingBinding?.dispose()

      const disposers = [
        node.onPropChange(onMutation),
        node.onChildrenChange(onMutation),
        node.onVisibleChange(onMutation),
        node.onLockChange(onMutation),
      ].filter((dispose): dispose is () => void => typeof dispose === 'function')

      nodeBindings.set(node.id, {
        node,
        dispose: () => {
          for (const dispose of disposers) dispose()
        },
      })
    }

    const syncNodeBindings = () => {
      for (const node of document.nodesMap.values()) {
        bindNode(node)
      }

      for (const [id, binding] of nodeBindings) {
        if (document.getNode(id) === binding.node) continue
        binding.dispose()
        nodeBindings.delete(id)
      }
    }

    syncNodeBindings()

    const disposers = [
      document.history.onStateChange(() => {
        syncNodeBindings()
        onMutation()
      }),
      document.onNodeAdd(event => {
        const node = event.isNode ? event : (event as unknown as { node?: Node }).node
        if (!node || node.document !== document) return
        bindNode(node)
        onMutation()
      }),
      document.onNodeRemove(event => {
        const removedNode = typeof event === 'string' ? undefined : (event as unknown as { node?: Node }).node
        const id = typeof event === 'string' ? event : removedNode?.id
        if (!id) return

        const nodeAtRemoval = removedNode ?? nodeBindings.get(id)?.node
        onMutation()

        queueMicrotask(() => {
          if (disposed || documentDisposed) return

          const currentNode = document.getNode(id)
          if (nodeAtRemoval && currentNode === nodeAtRemoval) return

          const currentBinding = nodeBindings.get(id)
          if (currentBinding && (!nodeAtRemoval || currentBinding.node === nodeAtRemoval)) {
            currentBinding.dispose()
            nodeBindings.delete(id)
          }

          if (currentNode) bindNode(currentNode)
        })
      }),
    ]

    documentDisposers.set(document.id, () => {
      if (documentDisposed) return
      documentDisposed = true

      for (const dispose of disposers) dispose()
      for (const binding of nodeBindings.values()) binding.dispose()
      nodeBindings.clear()
    })
  }

  for (const document of project.documents) {
    bindDocument(document)
  }

  const disposers = [
    project.onDocumentAdd(document => {
      bindDocument(document)
      onMutation()
    }),
    project.onDocumentRemove(event => {
      const id = typeof event === 'string' ? event : (event as unknown as { id?: string }).id
      if (!id) return

      documentDisposers.get(id)?.()
      documentDisposers.delete(id)
      onMutation()
    }),
    project.onCurrentDocumentChange(document => {
      bindDocument(document)
    }),
  ]

  return () => {
    if (disposed) return
    disposed = true

    for (const dispose of disposers) dispose()
    for (const dispose of documentDisposers.values()) dispose()
    documentDisposers.clear()
  }
}
