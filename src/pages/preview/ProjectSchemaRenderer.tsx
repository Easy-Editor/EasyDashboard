import type { ProjectDetail } from '@/api/contracts'
import { components } from '@/editor/materials'
import { getViewportFromSchema } from '@/editor/persistence/schema-viewport'
import { materialManager } from '@/editor/remote'
import { loadRemoteMaterialsFromComponentsMap } from '@/editor/remote/util'
import type { DataSourceEngine, ProjectSchema } from '@easy-editor/core'
import { PureRenderer } from '@easy-editor/react-renderer-dashboard'
import { observer } from 'mobx-react'
import { useMemo } from 'react'
import { PreviewState } from './PreviewState'

export type PreviewDataSourceEngine = DataSourceEngine['createDataSourceEngine']

export const ProjectSchemaRenderer = observer(
  ({
    project,
    createDataSourceEngine,
  }: {
    project: ProjectDetail<ProjectSchema>
    createDataSourceEngine: PreviewDataSourceEngine
  }) => {
    const viewport = useMemo(() => getViewportFromSchema(project.schema), [project.schema])

    return (
      <main
        className='h-screen w-full overflow-hidden bg-black'
        aria-label={`${project.name} 预览，${viewport.width} × ${viewport.height}`}
      >
        <PureRenderer
          projectSchema={project.schema}
          components={{ ...components, ...materialManager.remoteComponentsMap }}
          viewport={viewport}
          onBeforeNavigate={async (_pageSchema, projectComponentsMap) => {
            await loadRemoteMaterialsFromComponentsMap(projectComponentsMap)
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
