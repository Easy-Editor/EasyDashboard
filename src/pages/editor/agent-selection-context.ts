import type { AgentSelectionContext } from '@/features/agent'

type SelectionNode = {
  id: string
  title: string
  componentName: string
}

type EditorSelectionSource = {
  currentDocument?: {
    id: string
    fileName: string
    rootNode?: {
      getExtraProp?: (name: string, createIfNone?: boolean) => { getAsString?: () => string | null | undefined } | null
      getDashboardRect?: () => { width?: number; height?: number } | null
    } | null
  } | null
  designer: {
    selection: {
      getTopNodes: (includeRoot?: boolean) => readonly SelectionNode[]
    }
  }
  simulator?: {
    deviceStyle?: {
      viewport?: { width?: number; height?: number }
    }
  } | null
}

function positiveDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export function buildEditorAgentSelectionContext(source: EditorSelectionSource): AgentSelectionContext | undefined {
  const document = source.currentDocument
  if (!document) return undefined

  const root = document.rootNode
  const pageLabel = root?.getExtraProp?.('fileDesc', false)?.getAsString?.()?.trim() || document.fileName
  const selectedRefs = source.designer.selection
    .getTopNodes(false)
    .slice(0, 12)
    .map(node => ({
      id: node.id,
      title: node.title || node.componentName,
      componentName: node.componentName,
    }))
  const dashboardRect = root?.getDashboardRect?.()
  const deviceViewport = source.simulator?.deviceStyle?.viewport
  const width = positiveDimension(dashboardRect?.width) ?? positiveDimension(deviceViewport?.width)
  const height = positiveDimension(dashboardRect?.height) ?? positiveDimension(deviceViewport?.height)

  return {
    pageId: document.id,
    pageLabel,
    selectedRefs,
    ...(width === undefined && height === undefined
      ? {}
      : {
          viewport: {
            ...(width === undefined ? {} : { width }),
            ...(height === undefined ? {} : { height }),
          },
        }),
  }
}
