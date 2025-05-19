import { CodeEditor } from '@/components/common/CodeEditor'
import { project } from '@easy-editor/core'
import { observer } from 'mobx-react'

export const SchemaSidebar = observer(() => {
  const schema = project.export()

  return (
    <div className='w-full h-full flex flex-col overflow-y-auto px-4'>
      <CodeEditor language='json' value={JSON.stringify(schema, null, 2)} />
    </div>
  )
})
