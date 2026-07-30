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
import { useMemo, useState } from 'react'
import { PreviewState } from './PreviewState'

export type PreviewDataSourceEngine = DataSourceEngine['createDataSourceEngine']

export const ProjectSchemaRenderer = observer(
  ({
    project,
    requestedPageId,
    createDataSourceEngine,
  }: {
    project: ProjectDetail<unknown>
    requestedPageId?: string | null
    createDataSourceEngine: PreviewDataSourceEngine
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

    return (
      <main
        {...rootAttributes}
        className='h-screen w-full overflow-hidden bg-black'
        aria-label={createDashboardPreviewAriaLabel(project.name, viewport)}
        style={rootStyle}
      >
        <PureRenderer
          key={`${project.id}:${initialPage ?? 'empty'}`}
          projectSchema={projectSchema}
          initialPage={initialPage}
          components={{ ...components, ...materialManager.remoteComponentsMap }}
          viewport={viewport}
          onBeforeNavigate={async (pageSchema, projectComponentsMap) => {
            await loadRemoteMaterialsFromComponentsMap(projectComponentsMap)
            const fileName = pageSchema.fileName
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
          }}
          appHelper={{
            dataSourceEngine: {
              createDataSourceEngine,
            },
          }}
          loadingContent={<PreviewState title='正在装配画布…' detail={`${viewport.width} × ${viewport.height}`} />}
          notFoundContent={<PreviewState title='项目中没有可预览的页面' />}
        />
      </main>
    )
  },
)
