import { EditorSessionProvider } from '@/contexts/editor-session-context'
import { EditorThumbnailProvider } from '@/features/thumbnails/EditorThumbnailProvider'
import { type RootSchema, project } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { Suspense, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router'
import AppLayout from './EditorLayout'
import Renderer from './canvas/Renderer'
import { resolveEditorPageRoute, selectEditorRouteProjectState, withEditorPage } from './editor-page-route'

const EditorPageRouteSync = observer(() => {
  const [searchParams, setSearchParams] = useSearchParams()
  const componentsTree = project.get<RootSchema[]>('componentsTree') || []
  const projectMeta = project.get<unknown>('meta')
  const { pages, startPageId } = selectEditorRouteProjectState(componentsTree, projectMeta)
  const pagesRouteKey = pages.map(page => `${page.pageId}\u0000${page.fileName}`).join('\u0001')
  const currentFileName = project.currentDocument?.fileName
  const routeStateRef = useRef({
    pages,
    currentFileName,
    startPageId,
  })
  const routeTargetRef = useRef<string | null>(null)

  routeStateRef.current = {
    pages,
    currentFileName,
    startPageId,
  }

  // Route changes own the next page transition. Current-document changes are
  // deliberately excluded so a sidebar click can update the URL instead of
  // being reverted to the previous query value.
  useEffect(() => {
    if (!pagesRouteKey) return
    const state = routeStateRef.current
    const decision = resolveEditorPageRoute({
      pages: state.pages,
      requestedPageId: searchParams.get('page'),
      currentFileName: state.currentFileName,
      startPageId: state.startPageId,
    })
    if (!decision) return

    routeTargetRef.current = decision.pageId

    if (decision.shouldOpen) {
      const opened = project.open(decision.fileName)
      project.designer.selection.clear()
      const root = opened?.getRoot()
      if (root) project.designer.selection.select(root.id)
    }

    if (decision.shouldReplace) {
      setSearchParams(withEditorPage(searchParams, decision.pageId), { replace: true })
    }
  }, [pagesRouteKey, searchParams, setSearchParams])

  useEffect(() => {
    if (!currentFileName || !pagesRouteKey) return
    const currentPage = routeStateRef.current.pages.find(page => page.fileName === currentFileName)
    if (!currentPage) return

    const routeTarget = routeTargetRef.current
    if (routeTarget) {
      if (routeTarget !== currentPage.pageId) return
      routeTargetRef.current = null
      return
    }

    if (searchParams.get('page') === currentPage.pageId) return
    setSearchParams(withEditorPage(searchParams, currentPage.pageId), { replace: true })
  }, [currentFileName, pagesRouteKey, searchParams, setSearchParams])

  return null
})

export default function Editor() {
  const { projectId } = useParams<{ projectId: string }>()

  if (!projectId) {
    return <div className='grid h-screen place-items-center bg-[#080A0D] text-sm text-[#8D99A3]'>项目地址无效</div>
  }

  return (
    <EditorSessionProvider key={projectId} projectId={projectId}>
      <EditorThumbnailProvider>
        <Suspense fallback={<div className='w-full h-screen flex items-center justify-center'>初始化编辑器中...</div>}>
          <EditorPageRouteSync />
          <AppLayout>
            <Renderer />
          </AppLayout>
        </Suspense>
      </EditorThumbnailProvider>
    </EditorSessionProvider>
  )
}
