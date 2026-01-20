import { Button } from '@/components/ui/button'
import { savePageInfoToLocalStorage, savePageSchemaToLocalStorage, saveProjectSchemaToLocalStorage } from '@/lib/schema'
import { cn } from '@/lib/utils'
import { TRANSFORM_STAGE, project } from '@easy-editor/core'
import { toast } from 'sonner'
import { MainNav } from './Nav'

export function AppHeader({ className }: { className?: string }) {
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
    toast.success('保存成功')
  }

  const preview = () => {
    save('page')
    window.open('/preview', '_blank')
  }

  return (
    <header
      className={cn(
        'h-[52px] w-full',
        'bg-background/80 backdrop-blur-xl',
        'border-b border-border/60',
        'sticky top-0 z-50',
        'transition-all duration-200',
        className,
      )}
    >
      <div className='w-full h-full px-4 flex items-center justify-between'>
        <MainNav />
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='sm' className='h-8 gap-2' onClick={preview}>
            预览
          </Button>
          <Button size='sm' className='h-8 gap-2' onClick={() => save('project')}>
            保存
          </Button>
        </div>
      </div>
    </header>
  )
}
