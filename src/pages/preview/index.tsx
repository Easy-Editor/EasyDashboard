import { components } from '@/editor/materials'
import { materialManager } from '@/editor/remote'
import { loadRemoteMaterialsFromComponentsMap } from '@/editor/remote/util'
import { getPageDataFromLocalStorage, getProjectSchemaFromLocalStorage } from '@/lib/schema'
import type { ProjectSchema } from '@easy-editor/core'
import { createDataSourceEngine } from '@easy-editor/plugin-datasource'
import { PureRenderer } from '@easy-editor/react-renderer-dashboard'
import { observer } from 'mobx-react'
import { useState } from 'react'

const Preview = observer(() => {
  const [projectSchema] = useState<ProjectSchema>(() => getProjectSchemaFromLocalStorage())

  return (
    <div className='h-full w-full'>
      <PureRenderer
        projectSchema={projectSchema}
        components={{ ...components, ...materialManager.remoteComponentsMap }}
        viewport={{ width: 1920, height: 1080 }}
        onBeforeNavigate={async (pageSchema, projectComponentsMap) => {
          // 尝试从页面级存储获取 componentsMap
          const pageData = pageSchema.fileName ? getPageDataFromLocalStorage(pageSchema.fileName) : null

          // 只加载当前页面的远程物料
          if (pageData?.componentsMap) {
            // 新格式：从页面级存储加载
            await loadRemoteMaterialsFromComponentsMap(pageData.componentsMap)
          } else if (projectComponentsMap) {
            // 旧格式兼容：从项目级 componentsMap 加载
            await loadRemoteMaterialsFromComponentsMap(projectComponentsMap)
          }
        }}
        appHelper={{
          dataSourceEngine: {
            createDataSourceEngine,
          },
        }}
        loadingContent={
          <div className='flex h-full w-full items-center justify-center'>
            <div className='text-sm text-muted-foreground'>loading...</div>
          </div>
        }
        notFoundContent={
          <div className='flex h-full w-full items-center justify-center'>
            <div className='text-sm text-muted-foreground'>页面不存在</div>
          </div>
        }
      />
    </div>
  )
})

export default Preview
