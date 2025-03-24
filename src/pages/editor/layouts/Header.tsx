import { Button } from '@/components/ui/button'
import { project } from '@/editor'
import { savePageInfoToLocalStorage, savePageSchemaToLocalStorage, saveProjectSchemaToLocalStorage } from '@/lib/schema'
import { cn } from '@/lib/utils'
import { TRANSFORM_STAGE } from '@easy-editor/core'
import { useNavigate } from 'react-router'
import { MainNav } from './Nav'

export function AppHeader({ className }: { className?: string }) {
  const navigate = useNavigate()

  const save = (kind: 'project' | 'page' = 'page') => {
    if (kind === 'project') {
      saveProjectSchemaToLocalStorage(project.export(TRANSFORM_STAGE.SAVE))
    } else {
      const pageInfo = []
      for (const doc of project.documents) {
        pageInfo.push({ path: doc.fileName, title: doc.rootNode?.getExtraPropValue('fileDesc') as string })
        savePageSchemaToLocalStorage(doc.fileName, doc.export(TRANSFORM_STAGE.SAVE))
      }
      savePageInfoToLocalStorage(pageInfo)
    }
  }

  const preview = () => {
    // navigate('/preview')
    save('page')
    window.open('/preview', '_blank')
  }

  return (
    <header
      className={cn(
        'w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className,
      )}
    >
      <div className='border-border/70 dark:border-border w-full border-dashed'>
        <div className='flex h-14 items-center px-4'>
          <MainNav />
          <div className='flex flex-1 items-center justify-between gap-2 md:justify-end'>
            <div className='w-full flex-1 md:w-auto md:flex-none' />
            <div className='flex items-center gap-2'>
              <Button variant='outline' onClick={preview}>
                预览
              </Button>
              <Button variant='outline' onClick={() => save('page')}>
                保存
              </Button>
              {/* <Button variant='outline' onClick={() => save('project')}>
                保存项目
              </Button> */}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
