import { AlertModal } from '@/components/common/AlertModal'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubItem } from '@/components/ui/sidebar'
import { SidebarMenuExtra, SidebarMenuExtraItem } from '@/components/ui/sidebar-extra'
import { loadRemoteMaterialsFromComponentsMap } from '@/editor/remote/util'
import {
  DashboardPageConflictError,
  createDashboardPage,
  deleteDashboardPage,
  duplicateDashboardPage,
  renameDashboardPage,
  reorderDashboardPage,
  setDashboardStartPage,
} from '@/features/projects/page-operations'
import {
  type DashboardProjectDocument,
  decodeDashboardProjectDocument,
  resolvePageFileName,
  serializeDashboardProjectDocument,
} from '@/features/projects/project-document'
import { cn } from '@/lib/utils'
import { type Document, type RootSchema, project } from '@easy-editor/core'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CirclePlus,
  Copy,
  File,
  FilePenLine,
  Flag,
  Folder,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { observer } from 'mobx-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageModal, type PageModalProps } from './PageModal'

/** 页面信息（用于显示列表） */
interface PageInfo {
  pageId: string
  fileName: string
  fileDesc: string
  isStartPage: boolean
  isLoaded: boolean
  doc?: Document
}

function getRuntimeDocument(): DashboardProjectDocument {
  const exportedSchema = project.export()
  const storedTree = project.get<RootSchema[]>('componentsTree') || []
  const exportedPages = new Map(exportedSchema.componentsTree.map(page => [page.fileName, page]))

  return decodeDashboardProjectDocument({
    ...exportedSchema,
    componentsTree: storedTree.map(page => exportedPages.get(page.fileName) ?? page),
  })
}

function focusDocumentRoot(document: Document | null | undefined) {
  const selection = project.designer.selection
  selection.clear()
  const root = document?.getRoot()
  if (root) selection.select(root.id)
}

function applyRuntimeDocument(document: DashboardProjectDocument, openPageId?: string) {
  const serialized = serializeDashboardProjectDocument(document)
  const openFileName = openPageId ? resolvePageFileName(serialized, openPageId) : undefined
  project.load(serialized.editorSchema, true)
  const opened = openFileName ? project.open(openFileName) : project.currentDocument
  focusDocumentRoot(opened)
}

export const PageSidebar = observer(() => {
  const loadedDocs = project.documents
  const currentDoc = project.currentDocument
  const dashboardDocument = decodeDashboardProjectDocument({
    ...project.export(),
    componentsTree: project.get<RootSchema[]>('componentsTree') || [],
  })
  const componentsTree = dashboardDocument.editorSchema.componentsTree

  // 合并已加载和未加载的页面信息
  const pages: PageInfo[] = componentsTree.map(schema => {
    const loadedDoc = loadedDocs.find(doc => doc.fileName === schema.fileName)
    return {
      pageId: schema.meta.easyDashboard.pageId,
      fileName: schema.fileName || '',
      fileDesc: String(schema.fileDesc || schema.fileName || ''),
      isStartPage: schema.meta.easyDashboard.pageId === dashboardDocument.presentation.startPageId,
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
    const document = getRuntimeDocument()
    try {
      if (editData) {
        const page = document.editorSchema.componentsTree.find(page => page.fileName === editData.fileName)
        if (page) {
          const currentPageId = document.editorSchema.componentsTree.find(
            item => item.fileName === project.currentDocument?.fileName,
          )?.meta.easyDashboard.pageId
          applyRuntimeDocument(
            renameDashboardPage(document, page.meta.easyDashboard.pageId, formData.fileDesc),
            currentPageId,
          )
        }
      } else {
        const beforeIds = new Set(document.editorSchema.componentsTree.map(page => page.meta.easyDashboard.pageId))
        const next = createDashboardPage(document, formData)
        const createdPage = next.editorSchema.componentsTree.find(
          page => !beforeIds.has(page.meta.easyDashboard.pageId),
        )
        applyRuntimeDocument(next, createdPage?.meta.easyDashboard.pageId)
      }
    } catch (error) {
      if (error instanceof DashboardPageConflictError) {
        toast.error('页面标识必须唯一')
        return
      }
      throw error
    }
    setEditData(undefined)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem className='p-2'>
        <PageModal
          open={open}
          data={editData}
          onConfirm={handleConfirm}
          onClose={() => {
            setOpen(false)
            setEditData(undefined)
          }}
        >
          <Collapsible className='group/collapsible' defaultOpen>
            <div className='flex w-full items-center justify-between rounded-md p-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'>
              <div className='text-sm flex items-center gap-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground'>
                <CollapsibleTrigger asChild>
                  <button
                    type='button'
                    aria-label='展开或收起页面列表'
                    className='flex size-5 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring'
                  >
                    <ChevronRight
                      className='size-4 transition-transform group-data-[state=open]/collapsible:rotate-90'
                      aria-hidden='true'
                    />
                  </button>
                </CollapsibleTrigger>
                <Folder />
                页面
              </div>
              <SidebarMenuExtra>
                <SidebarMenuExtraItem>
                  <button
                    type='button'
                    aria-label='新增页面'
                    className='flex size-5 items-center justify-center [&>svg]:size-4'
                    onClick={() => setOpen(true)}
                  >
                    <CirclePlus />
                  </button>
                </SidebarMenuExtraItem>
              </SidebarMenuExtra>
            </div>
            <CollapsibleContent>
              <SidebarMenuSub className='mr-0 pr-0'>
                {pages.map((page, index) => (
                  <Page
                    key={page.pageId}
                    page={page}
                    pageIndex={index}
                    pageCount={pages.length}
                    currentDoc={currentDoc}
                    handleEdit={handleEdit}
                  />
                ))}
              </SidebarMenuSub>
            </CollapsibleContent>
          </Collapsible>
        </PageModal>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})

const Page: React.FC<{
  page: PageInfo
  pageIndex: number
  pageCount: number
  currentDoc: Document | undefined
  handleEdit: (page: PageInfo) => void
}> = props => {
  const { page, pageIndex, pageCount, currentDoc, handleEdit } = props
  const [isShowExtra, setIsShowExtra] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSelect = async (page: PageInfo) => {
    // 如果已加载，直接打开
    if (page.isLoaded && page.doc) {
      focusDocumentRoot(page.doc.open())
      return
    }

    // 未加载页面仍存在于服务端草稿的 canonical componentsTree 中。
    setIsLoading(true)
    try {
      await loadRemoteMaterialsFromComponentsMap(project.export().componentsMap)
      focusDocumentRoot(project.open(page.fileName))
    } catch (error) {
      console.error('Failed to load page:', error)
      toast.error('页面加载失败')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = (page: PageInfo) => {
    const document = getRuntimeDocument()
    if (document.editorSchema.componentsTree.length === 1) {
      toast.error('至少需要一个页面')
      return
    }

    const currentPageId = document.editorSchema.componentsTree.find(item => item.fileName === currentDoc?.fileName)
      ?.meta.easyDashboard.pageId
    const next = deleteDashboardPage(document, page.pageId)
    const openPageId =
      currentPageId === page.pageId ? next.editorSchema.componentsTree[0].meta.easyDashboard.pageId : currentPageId
    applyRuntimeDocument(next, openPageId)
  }

  const handleDuplicate = () => {
    const document = getRuntimeDocument()
    const beforeIds = new Set(document.editorSchema.componentsTree.map(item => item.meta.easyDashboard.pageId))
    const next = duplicateDashboardPage(document, page.pageId)
    const duplicate = next.editorSchema.componentsTree.find(item => !beforeIds.has(item.meta.easyDashboard.pageId))
    applyRuntimeDocument(next, duplicate?.meta.easyDashboard.pageId)
  }

  const handleReorder = (toIndex: number) => {
    const document = getRuntimeDocument()
    const currentPageId = document.editorSchema.componentsTree.find(item => item.fileName === currentDoc?.fileName)
      ?.meta.easyDashboard.pageId
    applyRuntimeDocument(reorderDashboardPage(document, page.pageId, toIndex), currentPageId)
  }

  const handleSetStartPage = () => {
    const document = getRuntimeDocument()
    const currentPageId = document.editorSchema.componentsTree.find(item => item.fileName === currentDoc?.fileName)
      ?.meta.easyDashboard.pageId
    applyRuntimeDocument(setDashboardStartPage(document, page.pageId), currentPageId)
  }

  const isCurrentPage = page.fileName === currentDoc?.fileName

  return (
    <SidebarMenuSubItem
      key={page.fileName}
      onMouseEnter={() => setIsShowExtra(true)}
      onMouseLeave={() => setIsShowExtra(false)}
      className={cn(
        'flex min-h-12 w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isCurrentPage && 'bg-sidebar-accent text-sidebar-accent-foreground',
        isLoading && 'opacity-50 pointer-events-none',
      )}
    >
      <button
        type='button'
        aria-label={`打开页面：${page.fileDesc}`}
        aria-current={isCurrentPage ? 'page' : undefined}
        className='flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground'
        onClick={() => void handleSelect(page)}
      >
        <File />
        <span className='min-w-0 flex-1'>
          <span className='block truncate text-xs font-medium text-[var(--ed-ink-soft)]'>{page.fileDesc}</span>
          <span className='mt-0.5 block truncate font-mono text-[9px] uppercase tracking-wide text-[var(--ed-ink-faint)]'>
            PAGE {String(pageIndex + 1).padStart(2, '0')} · {page.fileName}
          </span>
        </span>
        {page.isStartPage ? (
          <Flag className='size-3 shrink-0 fill-current text-[var(--ed-cyan)]' aria-label='启动页' />
        ) : null}
      </button>
      <SidebarMenuExtra>
        <SidebarMenuExtraItem
          className={cn('invisible group-focus-within/menu-sub-item:visible', isShowExtra && 'visible')}
        >
          <button
            type='button'
            aria-label={`编辑页面：${page.fileDesc}`}
            className='flex size-5 items-center justify-center [&>svg]:size-4'
            onClick={() => handleEdit(page)}
          >
            <FilePenLine />
          </button>
        </SidebarMenuExtraItem>
        <SidebarMenuExtraItem
          className={cn('invisible group-focus-within/menu-sub-item:visible', isShowExtra && 'visible')}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type='button' aria-label={`${page.fileDesc} 页面操作`} onClick={event => event.stopPropagation()}>
                <MoreHorizontal />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-ed-shell='editor' align='end'>
              <DropdownMenuItem onSelect={handleSetStartPage} disabled={page.isStartPage}>
                <Flag />
                设为启动页
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleDuplicate}>
                <Copy />
                复制页面
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleReorder(pageIndex - 1)} disabled={pageIndex === 0}>
                <ArrowUp />
                上移
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleReorder(pageIndex + 1)} disabled={pageIndex === pageCount - 1}>
                <ArrowDown />
                下移
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuExtraItem>
        <SidebarMenuExtraItem
          className={cn('invisible group-focus-within/menu-sub-item:visible', isShowExtra && 'visible')}
        >
          <AlertModal
            editorScoped
            title='确定删除吗？'
            description='删除后，该页面将无法恢复。'
            trigger={
              <button
                type='button'
                aria-label={`删除页面：${page.fileDesc}`}
                className='flex size-5 items-center justify-center [&>svg]:size-4'
                onClick={event => event.stopPropagation()}
              >
                <Trash2 />
              </button>
            }
            onConfirm={() => handleDelete(page)}
          />
        </SidebarMenuExtraItem>
      </SidebarMenuExtra>
    </SidebarMenuSubItem>
  )
}
