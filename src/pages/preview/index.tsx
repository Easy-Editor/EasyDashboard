import { components } from '@/editor'
import { getPageInfoFromLocalStorage, getPageSchemaFromLocalStorage } from '@/lib/schema'
import { LowCodeRenderer } from '@easy-editor/react-renderer-dashboard'
import { useEffect, useState } from 'react'

const Preview = () => {
  const [schema, setSchema] = useState<any>(null)

  useEffect(() => {
    const pageInfo = getPageInfoFromLocalStorage()
    if (pageInfo.length === 0) {
      return
    }

    const pageSchema = getPageSchemaFromLocalStorage(pageInfo[0].id)
    setSchema(pageSchema)

    console.log(pageInfo, pageSchema)
  }, [])

  return (
    <div className='h-full w-full'>
      {schema ? (
        <LowCodeRenderer schema={schema} components={components} />
      ) : (
        <div className='flex h-full w-full items-center justify-center'>
          <div className='text-sm text-muted-foreground'>loading...</div>
        </div>
      )}
    </div>
  )
}

export default Preview
