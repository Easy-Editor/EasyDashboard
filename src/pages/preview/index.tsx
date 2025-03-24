import { components } from '@/editor'
import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import { Renderer } from '@easy-editor/react-renderer-dashboard'
import { useEffect, useState } from 'react'

const Preview = () => {
  const [schema, setSchema] = useState<any>(null)

  useEffect(() => {
    const pageInfo = getPageInfoFromLocalStorage()
    if (pageInfo.length === 0) {
      return
    }

    const pageSchema = getPageSchemaFromLocalStorage(pageInfo[0].path)
    if (!pageSchema) {
      return
    }

    setSchema(pageSchema?.componentsTree[0])
    console.log(pageInfo, pageSchema)
  }, [])

  return (
    <div className='h-full w-full'>
      {schema ? (
        <Renderer schema={schema} components={components} viewport={{ width: 1920, height: 1080 }} />
      ) : (
        <div className='flex h-full w-full items-center justify-center'>
          <div className='text-sm text-muted-foreground'>loading...</div>
        </div>
      )}
    </div>
  )
}

export default Preview
