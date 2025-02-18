import { editor } from '@/editor'
import { customFieldItem } from '@/editor/setters'
import { SettingRender } from '@easy-editor/react-renderer'
import { observer } from 'mobx-react'

export const ConfigureSidebar = observer(() => {
  return (
    <div className='flex flex-col w-[350px]'>
      <div className='p-4 border-b border-gray-200'>
        <h2 className='text-lg font-medium'>Property Setting</h2>
      </div>
      <SettingRender editor={editor} customFieldItem={customFieldItem} />
    </div>
  )
})
