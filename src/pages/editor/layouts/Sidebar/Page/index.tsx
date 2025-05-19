import { AlertModal } from '@/components/common/AlertModal'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenu, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { SidebarMenuExtra, SidebarMenuExtraItem } from '@/components/ui/sidebar-extra'
import { defaultRootSchema } from '@/editor/const'
import { cn } from '@/lib/utils'
import { type Document, project } from '@easy-editor/core'
import { ChevronRight, CirclePlus, File, FilePenLine, Folder, Trash2 } from 'lucide-react'
import { observer } from 'mobx-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageModal, type PageModalProps } from './PageModal'

export const PageSidebar = observer(() => {
  const docs = project.documents
  const currentDoc = project.currentDocument
  const [editData, setEditData] = useState<{
    fileName: string
    fileDesc: string
  }>()
  const [open, setOpen] = useState(false)

  const handleEdit = (doc: Document) => {
    setEditData({
      fileName: doc.fileName,
      fileDesc: doc.rootNode?.getExtraPropValue('fileDesc') as string,
    })
    setOpen(true)
  }

  const handleConfirm: PageModalProps['onConfirm'] = formData => {
    if (editData) {
      const doc = project.getDocument(editData.fileName)
      if (doc) {
        doc.rootNode?.setExtraPropValue('fileDesc', formData.fileDesc)
      }
    } else {
      project.open({
        ...defaultRootSchema,
        fileName: formData.fileName,
        fileDesc: formData.fileDesc,
      })
    }
    setEditData(undefined)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem className='p-2'>
        <SidebarMenuItem>
          <PageModal
            open={open}
            data={editData}
            onConfirm={handleConfirm}
            onClose={() => {
              setOpen(false)
              setEditData(undefined)
            }}
          >
            <Collapsible
              className='group/collapsible [&[data-state=open]>div>div>svg:first-child]:rotate-90'
              defaultOpen
            >
              <div className='flex w-full items-center rounded-md p-2 text-left text-sm justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer'>
                <div className='text-sm flex items-center gap-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground'>
                  <CollapsibleTrigger asChild>
                    <ChevronRight className='transition-transform' />
                  </CollapsibleTrigger>
                  <Folder />
                  页面
                </div>
                <SidebarMenuExtra>
                  <SidebarMenuExtraItem>
                    <CirclePlus onClick={() => setOpen(true)} />
                  </SidebarMenuExtraItem>
                </SidebarMenuExtra>
              </div>
              <CollapsibleContent>
                <SidebarMenuSub className='mr-0 pr-0'>
                  {docs?.map(doc => (
                    <Page key={doc.id} doc={doc} currentDoc={currentDoc} handleEdit={handleEdit} />
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </Collapsible>
          </PageModal>
        </SidebarMenuItem>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})

const Page: React.FC<{
  doc: Document
  currentDoc: Document | undefined
  handleEdit: (doc: Document) => void
}> = props => {
  const { doc, currentDoc, handleEdit } = props
  const [isShowExtra, setIsShowExtra] = useState(false)

  const handleSelect = (doc: Document) => {
    doc.open()
  }

  const handleDelete = (doc: Document) => {
    // TODO: 待修复，删除最后一个页面时，再创建后页面无法显示
    if (project.documents.length === 1) {
      toast.error('至少需要一个页面')
      return
    }

    doc.remove()

    if (doc.id === currentDoc?.id) {
      project.documents[0].open()
    }
  }

  return (
    <div
      key={doc.id}
      onMouseEnter={() => setIsShowExtra(true)}
      onMouseLeave={() => setIsShowExtra(false)}
      className={cn(
        'flex w-full items-center rounded-md p-2 text-left text-sm justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer',
        doc.id === currentDoc?.id && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
    >
      <div
        className='flex-1 flex items-center gap-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground'
        onClick={() => handleSelect(doc)}
      >
        <File />
        <span>
          {doc.rootNode?.getExtraPropValue('fileDesc') as string}
          <span className='text-xs text-muted-foreground ml-1'>({doc.fileName})</span>
        </span>
      </div>
      <SidebarMenuExtra>
        <SidebarMenuExtraItem className={cn('invisible', isShowExtra && 'visible')}>
          <FilePenLine onClick={() => handleEdit(doc)} />
        </SidebarMenuExtraItem>
        <SidebarMenuExtraItem className={cn('invisible', isShowExtra && 'visible')}>
          <AlertModal
            title='确定删除吗？'
            description='删除后，该页面将无法恢复。'
            trigger={<Trash2 onClick={e => e.stopPropagation()} />}
            onConfirm={() => handleDelete(doc)}
          />
        </SidebarMenuExtraItem>
      </SidebarMenuExtra>
    </div>
  )
}
