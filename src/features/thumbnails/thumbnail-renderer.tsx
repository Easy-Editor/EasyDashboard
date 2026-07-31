import type { ProjectDetail } from '@/api/contracts'
import { type PreviewDataSourceEngine, ProjectSchemaRenderer } from '@/pages/preview/ProjectSchemaRenderer'
import type { ProjectSchema } from '@easy-editor/core'
import { createDataSourceEngine } from '@easy-editor/plugin-datasource'
import { createRoot } from 'react-dom/client'
import type { PureRendererMount } from './pipeline'
import { waitForRendererFrames } from './render-readiness'

function thumbnailProject(schema: ProjectSchema, draftVersion: number): ProjectDetail<ProjectSchema> {
  return {
    id: 'thumbnail-renderer',
    name: '画布缩略图',
    description: '',
    slug: null,
    state: 'draft',
    draftVersion,
    resolution: { width: 1920, height: 1080 },
    pageCount: schema.componentsTree?.length ?? 0,
    startPageId: null,
    isFavorite: false,
    thumbnail: {
      mode: 'auto',
      status: 'rendering',
      url: null,
      draftVersion: null,
      errorCode: null,
    },
    savedAt: new Date(0).toISOString(),
    publishedAt: null,
    currentReleaseNumber: null,
    deletedAt: null,
    updatedAt: new Date(0).toISOString(),
    schema,
  }
}

export async function mountThumbnailRenderer(
  container: HTMLElement,
  projectDocument: unknown,
  draftVersion: number,
): Promise<PureRendererMount> {
  const root = createRoot(container)
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    root.unmount()
  }

  try {
    root.render(
      <ProjectSchemaRenderer
        project={thumbnailProject(projectDocument as ProjectSchema, draftVersion)}
        createDataSourceEngine={createDataSourceEngine as PreviewDataSourceEngine}
      />,
    )

    await waitForRendererFrames()
    const captureElement = container.firstElementChild
    if (!captureElement) {
      throw new Error('缩略图渲染器未生成画布')
    }

    return {
      captureElement,
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
