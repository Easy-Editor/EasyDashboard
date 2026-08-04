import type { ProjectDetail } from '@/api/contracts'
import { components } from '@/editor/materials'
import { materialManager } from '@/editor/remote'
import { loadRemoteMaterialsFromComponentsMap } from '@/editor/remote/util'
import {
  createDashboardPreviewAriaLabel,
  createDashboardRenderModel,
} from '@/features/rendering/dashboard-render-adapter'
import type { DataSourceEngine } from '@easy-editor/core'
import { PureRenderer } from '@easy-editor/react-renderer-dashboard'
import { observer } from 'mobx-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PreviewScaleViewport } from './PreviewScaleViewport'
import { PreviewState } from './PreviewState'
import { createLatestPreviewNavigationRunner } from './preview-navigation-runner'

export type PreviewDataSourceEngine = DataSourceEngine['createDataSourceEngine']

export const ProjectSchemaRenderer = observer(
  ({
    project,
    requestedPageId,
    createDataSourceEngine,
    showPreviewScaleControls = false,
    onActivePageChange,
  }: {
    project: ProjectDetail<unknown>
    requestedPageId?: string | null
    createDataSourceEngine: PreviewDataSourceEngine
    showPreviewScaleControls?: boolean
    onActivePageChange?: (pageId: string) => void
  }) => {
    const routeRenderModel = useMemo(
      () => createDashboardRenderModel(project.schema, requestedPageId),
      [project.schema, requestedPageId],
    )
    const [activeNavigation, setActiveNavigation] = useState<{
      sourceSchema: unknown
      requestedPageId: string | null
      fileName: string
    } | null>(null)
    const normalizedRequestedPageId = requestedPageId ?? null
    const navigationRunner = useMemo(() => createLatestPreviewNavigationRunner(), [])
    const navigationScopeRef = useRef({
      sourceSchema: project.schema,
      requestedPageId: normalizedRequestedPageId,
    })
    if (
      navigationScopeRef.current.sourceSchema !== project.schema ||
      navigationScopeRef.current.requestedPageId !== normalizedRequestedPageId
    ) {
      navigationRunner.invalidate()
      navigationScopeRef.current = {
        sourceSchema: project.schema,
        requestedPageId: normalizedRequestedPageId,
      }
    }
    useEffect(() => () => navigationRunner.invalidate(), [navigationRunner])
    const [navigationError, setNavigationError] = useState<Error | null>(null)
    const hasActiveNavigation =
      activeNavigation !== null &&
      activeNavigation.sourceSchema === project.schema &&
      activeNavigation.requestedPageId === normalizedRequestedPageId
    const activePageFileName = hasActiveNavigation ? activeNavigation.fileName : routeRenderModel.initialPage
    const renderModel = useMemo(
      () => createDashboardRenderModel(project.schema, requestedPageId, activePageFileName),
      [activePageFileName, project.schema, requestedPageId],
    )
    const { initialPage, projectSchema } = routeRenderModel
    const { rootAttributes, rootStyle, viewport } = renderModel
    const remoteComponents = materialManager.remoteComponentsMap
    const materialRenderKey = Object.keys(remoteComponents).sort().join('|')

    if (navigationError) throw navigationError

    const renderer = (
      <main
        {...rootAttributes}
        className='h-full w-full overflow-hidden bg-black'
        aria-label={createDashboardPreviewAriaLabel(project.name)}
        style={rootStyle}
      >
        <PureRenderer
          key={`${project.id}:${initialPage ?? 'empty'}:${materialRenderKey}`}
          projectSchema={projectSchema}
          initialPage={initialPage}
          components={{ ...components, ...remoteComponents }}
          viewport={viewport}
          onBeforeNavigate={async (pageSchema, projectComponentsMap) => {
            setNavigationError(null)
            const nextPageId = routeRenderModel.document.editorSchema.componentsTree.find(
              page => page.fileName === pageSchema.fileName,
            )?.meta.easyDashboard.pageId
            const fileName = pageSchema.fileName

            try {
              await navigationRunner.run({
                load: async () => {
                  await loadRemoteMaterialsFromComponentsMap(projectComponentsMap)
                },
                commit: () => {
                  if (!fileName) return
                  setActiveNavigation(current => {
                    if (
                      current &&
                      current.sourceSchema === project.schema &&
                      current.requestedPageId === normalizedRequestedPageId &&
                      current.fileName === fileName
                    ) {
                      return current
                    }

                    return {
                      sourceSchema: project.schema,
                      requestedPageId: normalizedRequestedPageId,
                      fileName,
                    }
                  })
                  if (nextPageId) onActivePageChange?.(nextPageId)
                },
              })
            } catch (reason) {
              setNavigationError(reason instanceof Error ? reason : new Error('页面物料加载失败'))
            }
          }}
          appHelper={{
            dataSourceEngine: {
              createDataSourceEngine,
            },
          }}
          loadingContent={<PreviewState title='正在装配画布…' />}
          notFoundContent={<PreviewState title='项目中没有可预览的页面' />}
        />
      </main>
    )

    if (!showPreviewScaleControls) return renderer

    return <PreviewScaleViewport viewport={viewport}>{renderer}</PreviewScaleViewport>
  },
)
