import { AlertModal } from '@/components/common/AlertModal'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenu, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { SidebarMenuExtra, SidebarMenuExtraItem } from '@/components/ui/sidebar-extra'
import { defaultRootSchema } from '@/editor/const'
import { loadRemoteMaterialsFromComponentsMap } from '@/editor/remote/util'
import { cn } from '@/lib/utils'
import { type Document, type RootSchema, project } from '@easy-editor/core'
import { ChevronRight, CirclePlus, File, FilePenLine, Folder, Trash2 } from 'lucide-react'
import { observer } from 'mobx-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageModal, type PageModalProps } from './PageModal'

/** 页面信息（用于显示列表） */
interface PageInfo {
  fileName: string
  fileDesc: string
  isLoaded: boolean
  doc?: Document
}

export const PageSidebar = observer(() => {
  const loadedDocs = project.documents
  const currentDoc = project.currentDocument
  const componentsTree = project.get<RootSchema[]>('componentsTree') || []

  // 合并已加载和未加载的页面信息
  const pages: PageInfo[] = componentsTree.map(schema => {
    const loadedDoc = loadedDocs.find(doc => doc.fileName === schema.fileName)
    return {
      fileName: schema.fileName || '',
      fileDesc: (schema as any).fileDesc || schema.fileName || '',
      isLoaded: !!loadedDoc,
      doc: loadedDoc,
    }
  })

  const [editData, setEditData] = useState<{
    fileName: string
    fileDesc: string
  }>()
  const [open, setOpen] = useState(false)

  const handleEdit = (page: PageInfo) => {
    setEditData({
      fileName: page.fileName,
      fileDesc: page.fileDesc,
    })
    setOpen(true)
  }

  const handleConfirm: PageModalProps['onConfirm'] = formData => {
    if (editData) {
      const doc = project.getDocumentByFileName(editData.fileName)
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
                  {pages.map(page => (
                    <Page key={page.fileName} page={page} currentDoc={currentDoc} handleEdit={handleEdit} />
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
  page: PageInfo
  currentDoc: Document | undefined
  handleEdit: (page: PageInfo) => void
}> = props => {
  const { page, currentDoc, handleEdit } = props
  const [isShowExtra, setIsShowExtra] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSelect = async (page: PageInfo) => {
    // 如果已加载，直接打开
    if (page.isLoaded && page.doc) {
      page.doc.open()
      return
    }

    // 未加载页面仍存在于服务端草稿的 canonical componentsTree 中。
    setIsLoading(true)
    try {
      await loadRemoteMaterialsFromComponentsMap(project.export().componentsMap)
      project.open(page.fileName)
    } catch (error) {
      console.error('Failed to load page:', error)
      toast.error('页面加载失败')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = (page: PageInfo) => {
    if ((project.get<RootSchema[]>('componentsTree') || []).length === 1) {
      toast.error('至少需要一个页面')
      return
    }

    if (page.doc) {
      page.doc.remove()
    }

    // 如果删除的是当前页面，切换到第一个页面
    if (page.doc?.id === currentDoc?.id) {
      const firstDoc = project.documents[0]
      if (firstDoc) {
        firstDoc.open()
      }
    }
  }

  const isCurrentPage = page.doc?.id === currentDoc?.id

  return (
    <div
      key={page.fileName}
      onMouseEnter={() => setIsShowExtra(true)}
      onMouseLeave={() => setIsShowExtra(false)}
      className={cn(
        'flex w-full items-center rounded-md p-2 text-left text-sm justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer',
        isCurrentPage && 'bg-sidebar-accent text-sidebar-accent-foreground',
        isLoading && 'opacity-50 pointer-events-none',
      )}
    >
      <div
        className='flex-1 flex items-center gap-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground'
        onClick={() => handleSelect(page)}
      >
        <File />
        <span>
          {page.fileDesc}
          <span className='text-xs text-muted-foreground ml-1'>({page.fileName})</span>
        </span>
      </div>
      <SidebarMenuExtra>
        <SidebarMenuExtraItem className={cn('invisible', isShowExtra && 'visible')}>
          <FilePenLine onClick={() => handleEdit(page)} />
        </SidebarMenuExtraItem>
        <SidebarMenuExtraItem className={cn('invisible', isShowExtra && 'visible')}>
          <AlertModal
            title='确定删除吗？'
            description='删除后，该页面将无法恢复。'
            trigger={<Trash2 onClick={e => e.stopPropagation()} />}
            onConfirm={() => handleDelete(page)}
          />
        </SidebarMenuExtraItem>
      </SidebarMenuExtra>
    </div>
  )
}
