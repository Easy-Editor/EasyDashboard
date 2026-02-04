import { Button } from '@/components/ui/button'
import {
  type PageMeta,
  savePageDataToLocalStorage,
  savePageMetaListToLocalStorage,
  saveProjectSchemaToLocalStorage,
} from '@/lib/schema'
import { cn } from '@/lib/utils'
import { TRANSFORM_STAGE, project } from '@easy-editor/core'
import { toast } from 'sonner'
import { EditorModeTabs } from './EditorModeTabs'
import { HistoryButtons } from './HistoryButtons'
import { MainNav } from './Nav'

export function AppHeader({ className }: { className?: string }) {
  const save = (kind: 'project' | 'page' = 'page') => {
    if (kind === 'project') {
      // 保存整个项目（用于预览）
      saveProjectSchemaToLocalStorage(project.export(TRANSFORM_STAGE.SAVE))
    }

    // 按页面保存（ProjectSchema 格式，componentsTree 只有一个元素）
    const pageMetaList: PageMeta[] = []
    for (const doc of project.documents) {
      const schema = doc.export(TRANSFORM_STAGE.SAVE)
      const componentsMap = doc.getComponentsMap()

      // 保存页面数据（ProjectSchema 格式）
      savePageDataToLocalStorage(doc.fileName, {
        version: '1.0.0',
        componentsTree: [schema],
        componentsMap,
      })

      pageMetaList.push({
        fileName: doc.fileName,
        fileDesc: (doc.rootNode?.getExtraPropValue('fileDesc') as string) || doc.fileName,
      })
    }
    savePageMetaListToLocalStorage(pageMetaList)

    toast.success('保存成功')
  }

  const preview = () => {
    save('project')
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
        <div className='absolute left-1/2 -translate-x-1/2'>
          <EditorModeTabs />
        </div>
        <div className='flex items-center gap-2'>
          <HistoryButtons />
          <div className='h-4 w-px bg-border/60' />
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
