import type { Document, Node, Project } from '@easy-editor/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { bindProjectMutations } from './mutation-bridge'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function createEvent<TArgs extends unknown[]>() {
  const listeners = new Set<(...args: TArgs) => void>()

  return {
    emit: (...args: TArgs) => {
      for (const listener of listeners) listener(...args)
    },
    subscribe: (listener: (...args: TArgs) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function createNode(id: string) {
  const propChange = createEvent<[unknown]>()
  const childrenChange = createEvent<[]>()
  const visibleChange = createEvent<[boolean]>()
  const lockChange = createEvent<[boolean]>()

  const node = {
    id,
    document: undefined,
    isNode: true,
    onPropChange: propChange.subscribe,
    onChildrenChange: childrenChange.subscribe,
    onVisibleChange: visibleChange.subscribe,
    onLockChange: lockChange.subscribe,
  } as unknown as Node

  return {
    node,
    emitPropChange: () => propChange.emit({ path: 'title' }),
  }
}

function createDocument(id: string, initialNodes: Node[]) {
  const historyChange = createEvent<[]>()
  const nodeAdd = createEvent<[Node]>()
  const nodeRemove = createEvent<[string]>()

  const document = {
    id,
    nodesMap: new Map(initialNodes.map(node => [node.id, node])),
    history: {
      onStateChange: historyChange.subscribe,
    },
    onNodeAdd: nodeAdd.subscribe,
    onNodeRemove: nodeRemove.subscribe,
    getNode: (nodeId: string) => document.nodesMap.get(nodeId) ?? null,
  } as unknown as Document

  for (const node of initialNodes) {
    Reflect.set(node, 'document', document)
  }

  return {
    document,
    addNode: (node: Node) => {
      Reflect.set(node, 'document', document)
      document.nodesMap.set(node.id, node)
      nodeAdd.emit(node)
    },
    removeNode: (node: Node) => {
      document.nodesMap.delete(node.id)
      nodeRemove.emit(node.id)
    },
  }
}

function createProject(documents: Document[]) {
  const documentAdd = createEvent<[Document]>()
  const documentRemove = createEvent<[string | { id: string }]>()
  const currentDocumentChange = createEvent<[Document]>()

  return {
    project: {
      documents,
      onDocumentAdd: documentAdd.subscribe,
      onDocumentRemove: documentRemove.subscribe,
      onCurrentDocumentChange: currentDocumentChange.subscribe,
    } as unknown as Project,
    emitCurrentDocumentChange: currentDocumentChange.emit,
    emitDocumentRemove: documentRemove.emit,
  }
}

describe('bindProjectMutations', () => {
  it('reports a real core node property change synchronously without waiting for history state', async () => {
    vi.useFakeTimers()
    const documentStub = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('document', documentStub)
    vi.stubGlobal('location', { href: '' })
    vi.stubGlobal('window', {
      document: documentStub,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })

    const { project } = await import('@easy-editor/core')
    project.load(
      {
        version: '1.0.0',
        componentsTree: [
          {
            docId: 'document-1',
            componentName: 'Root',
            props: { title: 'before' },
            children: [],
          },
        ],
      },
      true,
    )
    const onMutation = vi.fn()
    const rootNode = project.documents[0]?.rootNode

    expect(rootNode).not.toBeNull()

    const dispose = bindProjectMutations(project, onMutation)
    try {
      rootNode?.setPropValue('title', 'after')
      expect(onMutation).toHaveBeenCalledOnce()

      const addedNode = project.documents[0]?.insertNode(rootNode!, {
        componentName: 'Text',
        props: { content: 'before' },
      })
      expect(addedNode).not.toBeNull()
      onMutation.mockClear()

      addedNode?.setPropValue('content', 'after')
      expect(onMutation).toHaveBeenCalledOnce()

      onMutation.mockClear()
      rootNode?.children?.insert(addedNode!, addedNode!.index)
      await Promise.resolve()
      onMutation.mockClear()

      addedNode?.setPropValue('content', 'after-again')
      expect(onMutation).toHaveBeenCalledOnce()
    } finally {
      dispose()
      project.unload()
    }
  })

  it('rebinds real core nodes restored by redo', async () => {
    vi.useFakeTimers()
    const documentStub = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('document', documentStub)
    vi.stubGlobal('location', { href: '' })
    vi.stubGlobal('window', {
      document: documentStub,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })

    const { project } = await import('@easy-editor/core')
    project.load(
      {
        version: '1.0.0',
        componentsTree: [
          {
            docId: 'document-1',
            componentName: 'Root',
            props: {},
            children: [],
          },
        ],
      },
      true,
    )
    const document = project.documents[0]
    const rootNode = document?.rootNode
    const onMutation = vi.fn()

    expect(document).toBeDefined()
    expect(rootNode).not.toBeNull()

    const dispose = bindProjectMutations(project, onMutation)
    try {
      await vi.advanceTimersByTimeAsync(1_000)
      const addedNode = document?.insertNode(rootNode!, {
        id: 'redo-node',
        componentName: 'Text',
        props: { content: 'before' },
      })
      expect(addedNode).not.toBeNull()

      await vi.advanceTimersByTimeAsync(1_000)
      document?.history.back()
      await Promise.resolve()
      expect(document?.getNode('redo-node')).toBeNull()

      document?.history.forward()
      const restoredNode = document?.getNode('redo-node')
      expect(restoredNode).not.toBeNull()
      expect(restoredNode).not.toBe(addedNode)
      onMutation.mockClear()

      restoredNode?.setPropValue('content', 'after-redo')
      expect(onMutation).toHaveBeenCalledOnce()
    } finally {
      dispose()
      project.unload()
    }
  })

  it('binds dynamically added nodes once and releases their listeners when removed or disposed', async () => {
    const { document, addNode, removeNode } = createDocument('document-1', [])
    const { project, emitCurrentDocumentChange } = createProject([document])
    const onMutation = vi.fn()
    const addedNode = createNode('node-2')
    const replacementNode = createNode('node-2')

    const dispose = bindProjectMutations(project, onMutation)
    addNode(addedNode.node)
    emitCurrentDocumentChange(document)
    onMutation.mockClear()

    addedNode.emitPropChange()
    expect(onMutation).toHaveBeenCalledOnce()

    removeNode(addedNode.node)
    await Promise.resolve()
    onMutation.mockClear()
    addedNode.emitPropChange()
    expect(onMutation).not.toHaveBeenCalled()

    addNode(addedNode.node)
    removeNode(addedNode.node)
    addNode(replacementNode.node)
    await Promise.resolve()
    onMutation.mockClear()

    addedNode.emitPropChange()
    replacementNode.emitPropChange()
    expect(onMutation).toHaveBeenCalledOnce()

    removeNode(replacementNode.node)
    dispose()
    document.nodesMap.set(replacementNode.node.id, replacementNode.node)
    await Promise.resolve()
    onMutation.mockClear()

    replacementNode.emitPropChange()
    expect(onMutation).not.toHaveBeenCalled()
  })

  it('releases document listeners for the runtime document removal payload', () => {
    const existingNode = createNode('node-1')
    const { document } = createDocument('document-1', [existingNode.node])
    const { project, emitDocumentRemove } = createProject([document])
    const onMutation = vi.fn()

    const dispose = bindProjectMutations(project, onMutation)
    emitDocumentRemove({ id: document.id })
    onMutation.mockClear()

    existingNode.emitPropChange()
    expect(onMutation).not.toHaveBeenCalled()

    dispose()
  })
})
