import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { TRANSFORM_STAGE, insertChildren, project } from '@easy-editor/core'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  Clipboard,
  ClipboardCopy,
  ClipboardPaste,
  ClipboardPen,
  Eye,
  Group,
  Layers,
  Lock,
  PanelBottom,
  PanelTop,
  Redo2,
  RefreshCw,
  Scissors,
  Trash2,
  Undo2,
  Ungroup,
} from 'lucide-react'
import { observer } from 'mobx-react'
import { Fragment, type PropsWithChildren, useState } from 'react'
import { UpdateCheckDialog } from './UpdateCheckDialog'

enum SelectionType {
  NONE = 'none',
  SINGLE = 'single',
  MULTIPLE = 'multiple',
}

interface MenuItem {
  key: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  children?: MenuItem[]
  separator?: boolean
  shortcut?: string
  onClick?: () => void
}

const menuItems: MenuItem[] = [
  {
    key: 'layer',
    label: '图层',
    icon: Layers,
    children: [
      {
        key: 'layer-top',
        label: '置顶',
        icon: PanelTop,
        shortcut: '⌘⇧↑',
        onClick: () => {
          const selected = project.designer.selection.getTopNodes(false)
          if (!selected?.length) return
          for (let i = selected.length - 1; i >= 0; i--) {
            selected[i].levelBottom() // 视觉置顶 = levelBottom
          }
        },
      },
      {
        key: 'layer-bottom',
        label: '置底',
        icon: PanelBottom,
        shortcut: '⌘⇧↓',
        onClick: () => {
          const selected = project.designer.selection.getTopNodes(false)
          if (!selected?.length) return
          for (let i = selected.length - 1; i >= 0; i--) {
            selected[i].levelTop() // 视觉置底 = levelTop
          }
        },
      },
      {
        key: 'layer-up',
        label: '上移一层',
        icon: ArrowUp,
        shortcut: '⌘↑',
        onClick: () => {
          const selected = project.designer.selection.getTopNodes(false)
          if (!selected?.length) return
          for (let i = selected.length - 1; i >= 0; i--) {
            const node = selected[i]
            if (node.parent && node.index >= node.parent.childrenNodes.length - 1) continue
            node.levelDown() // 视觉上移 = levelDown
          }
        },
      },
      {
        key: 'layer-down',
        label: '下移一层',
        icon: ArrowDown,
        shortcut: '⌘↓',
        onClick: () => {
          const selected = project.designer.selection.getTopNodes(false)
          if (!selected?.length) return
          for (let i = selected.length - 1; i >= 0; i--) {
            const node = selected[i]
            if (node.index <= 0) continue
            node.levelUp() // 视觉下移 = levelUp
          }
        },
      },
    ],
  },
  {
    key: 'align',
    label: '对齐',
    icon: AlignCenterVertical,
    children: [
      {
        key: 'align-left',
        label: '左对齐',
        icon: AlignStartVertical,
        onClick: () => project.designer.alignment.alignLeft(),
      },
      {
        key: 'align-right',
        label: '右对齐',
        icon: AlignEndVertical,
        onClick: () => project.designer.alignment.alignRight(),
      },
      {
        key: 'align-top',
        label: '上对齐',
        icon: AlignStartHorizontal,
        onClick: () => project.designer.alignment.alignTop(),
      },
      {
        key: 'align-bottom',
        label: '下对齐',
        icon: AlignEndHorizontal,
        onClick: () => project.designer.alignment.alignBottom(),
      },
      {
        key: 'align-h-center',
        label: '水平居中',
        icon: AlignCenterVertical,
        onClick: () => project.designer.alignment.alignHorizontalCenter(),
      },
      {
        key: 'align-v-center',
        label: '垂直居中',
        icon: AlignCenterHorizontal,
        separator: true,
        onClick: () => project.designer.alignment.alignVerticalCenter(),
      },
      {
        key: 'distribute-h',
        label: '水平分布',
        icon: AlignHorizontalDistributeCenter,
        onClick: () => project.designer.alignment.distributeHorizontal(),
      },
      {
        key: 'distribute-v',
        label: '垂直分布',
        icon: AlignVerticalDistributeCenter,
        onClick: () => project.designer.alignment.distributeVertical(),
      },
    ],
  },
  {
    key: 'group',
    label: '成组',
    icon: Group,
    shortcut: '⌘G',
    onClick: () => {
      const doc = project.currentDocument
      const selection = project.designer.selection
      if (!doc) return
      const selected = selection.getTopNodes(false)
      if (!selected || selected.length < 2) return
      const groupNode = (doc as any).group(selected.map((n: any) => n.id))
      if (groupNode) selection.select(groupNode.id)
    },
  },
  {
    key: 'ungroup',
    label: '取消成组',
    icon: Ungroup,
    shortcut: '⌘⇧G',
    separator: true,
    onClick: () => {
      const doc = project.currentDocument
      const selection = project.designer.selection
      if (!doc) return
      const selected = selection.getTopNodes(false)
      if (!selected?.length) return
      for (const node of selected) {
        if (node.isGroup) {
          ;(doc as any).ungroup(node)
        }
      }
      selection.clear()
    },
  },
  {
    key: 'copy',
    label: '复制',
    icon: ClipboardCopy,
    shortcut: '⌘C',
    async onClick() {
      const selected = project.designer.selection.getTopNodes(false)
      if (!selected?.length) return
      const componentsTree = selected.map(item => item?.export(TRANSFORM_STAGE.CLONE))
      const data = { type: 'NodeSchema', componentsMap: {}, componentsTree }
      await navigator.clipboard.writeText(JSON.stringify(data))
    },
  },
  {
    key: 'cut',
    label: '剪切',
    icon: Scissors,
    shortcut: '⌘X',
    async onClick() {
      const selection = project.designer.selection
      const selected = selection.getTopNodes(false)
      if (!selected?.length) return
      const componentsTree = selected.map(item => item?.export(TRANSFORM_STAGE.CLONE))
      const data = { type: 'NodeSchema', componentsMap: {}, componentsTree }
      await navigator.clipboard.writeText(JSON.stringify(data))
      for (const node of selected) {
        node.remove()
      }
      selection.clear()
    },
  },
  {
    key: 'paste',
    label: '粘贴',
    icon: ClipboardPaste,
    shortcut: '⌘V',
    async onClick() {
      const doc = project.currentDocument
      const selection = project.designer.selection
      if (!doc) return
      try {
        const data = JSON.parse(await navigator.clipboard.readText())
        if (data.componentsTree) {
          const nodes = insertChildren(doc.rootNode!, data.componentsTree)
          if (nodes) selection.selectAll(nodes.map(o => o.id))
        }
      } catch {}
    },
  },
  {
    key: 'cv',
    label: '拷贝',
    icon: ClipboardPen,
    shortcut: '⌘D',
    onClick() {
      const doc = project.currentDocument
      const selection = project.designer.selection
      if (!doc) return
      const selected = selection.getTopNodes(false)
      if (!selected?.length) return
      const newNodesId: string[] = []
      for (const node of selected) {
        const cloneSchema = node.export(TRANSFORM_STAGE.CLONE)
        cloneSchema.$dashboard!.rect!.x = (cloneSchema.$dashboard!.rect!.x ?? 0) + 10
        cloneSchema.$dashboard!.rect!.y = (cloneSchema.$dashboard!.rect!.y ?? 0) + 10
        const newNode = doc.insertNode(node.parent!, cloneSchema, node.index + 1)
        if (newNode) newNodesId.push(newNode.id)
      }
      selection.selectAll(newNodesId)
    },
  },
  {
    key: 'copy-paste-as',
    label: '...复制/粘贴为',
    icon: Clipboard,
    children: [
      {
        key: 'copy-component-style',
        label: '复制组件样式',
      },
      {
        key: 'paste-component-style',
        label: '粘贴组件样式',
      },
      {
        key: 'copy-component-event',
        label: '复制组件事件',
      },
      {
        key: 'paste-component-event',
        label: '粘贴组件事件',
      },
    ],
    separator: true,
  },

  {
    key: 'show',
    label: '显示',
    icon: Eye,
    shortcut: '⌘⇧H',
    onClick() {
      const selected = project.designer.selection.getTopNodes(false)
      if (!selected?.length) return
      for (const node of selected) node.hide(false)
    },
  },
  {
    key: 'hide',
    label: '隐藏',
    icon: Eye,
    shortcut: '⌘⇧H',
    onClick() {
      const selection = project.designer.selection
      const selected = selection.getTopNodes(false)
      if (!selected?.length) return
      for (const node of selected) node.hide()
      selection.clear()
    },
  },
  {
    key: 'unlock',
    label: '解锁',
    icon: Lock,
    shortcut: '⌘⇧L',
    separator: true,
    onClick() {
      const selection = project.designer.selection
      const selected = selection.getTopNodes(false)
      if (!selected?.length) return
      for (const node of selected) node.lock(false)
      selection.clear()
    },
  },
  {
    key: 'lock',
    label: '锁定',
    icon: Lock,
    shortcut: '⌘⇧L',
    separator: true,
    onClick() {
      const selection = project.designer.selection
      const selected = selection.getTopNodes(false)
      if (!selected?.length) return
      for (const node of selected) node.lock()
      selection.clear()
    },
  },
  {
    key: 'check-updates',
    label: '检查组件更新',
    icon: RefreshCw,
    separator: true,
  },
  {
    key: 'undo',
    label: '撤销',
    icon: Undo2,
    shortcut: '⌘Z',
    onClick() {
      project.currentDocument?.history.back()
    },
  },
  {
    key: 'redo',
    label: '重做',
    icon: Redo2,
    shortcut: '⌘Y',
    separator: true,
    onClick() {
      project.currentDocument?.history.forward()
    },
  },
  {
    key: 'delete',
    label: '删除',
    icon: Trash2,
    shortcut: 'Del',
    onClick() {
      const selection = project.designer.selection
      const selected = selection.getTopNodes(false)
      if (!selected?.length) return
      for (const node of selected) node.remove()
      selection.clear()
    },
  },
]

const getMenuItems = (selectionType: SelectionType) => {
  let keys: string[] = []
  switch (selectionType) {
    case SelectionType.NONE:
      keys = ['paste', 'undo', 'redo', 'check-updates']
      break
    case SelectionType.SINGLE:
      keys = [
        'layer',
        'group',
        'ungroup',
        'copy',
        'cut',
        'paste',
        'cv',
        'copy-paste-as',
        'hide',
        'lock',
        'undo',
        'redo',
        'check-updates',
        'delete',
      ]
      break
    case SelectionType.MULTIPLE:
      keys = [
        'layer',
        'align',
        'group',
        'ungroup',
        'copy',
        'cut',
        'paste',
        'cv',
        'hide',
        'lock',
        'undo',
        'redo',
        'check-updates',
        'delete',
      ]
      break
  }

  return menuItems.filter(item => keys.includes(item.key))
}

interface RendererContextMenuProps extends PropsWithChildren {}

export const RendererContextMenu = observer(({ children }: RendererContextMenuProps) => {
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)

  const currentDoc = project.currentDocument
  if (!currentDoc) {
    return children
  }

  const selection = project.designer.selection
  const selected = selection.getTopNodes(false)
  const selectionType =
    selected.length === 0 ? SelectionType.NONE : selected.length === 1 ? SelectionType.SINGLE : SelectionType.MULTIPLE
  const menuItems = getMenuItems(selectionType)

  // 处理菜单项点击
  const handleMenuItemClick = (item: MenuItem) => {
    if (item.key === 'check-updates') {
      setUpdateDialogOpen(true)
    } else if (item.onClick) {
      item.onClick()
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className='flex flex-1 min-w-0 min-h-0 w-full'>{children}</ContextMenuTrigger>
        <ContextMenuContent className='w-40'>
          {menuItems.map(item => (
            <Fragment key={item.key}>
              {item.children ? (
                <ContextMenuSub>
                  <ContextMenuSubTrigger className='text-xs h-8 px-2'>
                    {item.icon && <item.icon className='w-4 h-4 mr-2' />}
                    {item.label}
                    {item.shortcut && <ContextMenuShortcut className='text-xs'>{item.shortcut}</ContextMenuShortcut>}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className='w-32 text-xs'>
                    {item.children.map(child => (
                      <Fragment key={child.key}>
                        <ContextMenuItem className='h-8 px-2 text-xs gap-0' onClick={child?.onClick}>
                          {child.icon && <child.icon className='w-4 h-4 mr-2' />}
                          {child.label}
                          {child.shortcut && (
                            <ContextMenuShortcut className='text-xs'>{child.shortcut}</ContextMenuShortcut>
                          )}
                        </ContextMenuItem>
                        {child.separator && <ContextMenuSeparator className='my-1' />}
                      </Fragment>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : (
                <ContextMenuItem
                  key={item.key}
                  className='h-8 px-2 text-xs gap-0'
                  onClick={() => handleMenuItemClick(item)}
                >
                  {item.icon && <item.icon className='w-4 h-4 mr-2' />}
                  {item.label}
                  {item.shortcut && <ContextMenuShortcut className='text-xs'>{item.shortcut}</ContextMenuShortcut>}
                </ContextMenuItem>
              )}
              {item.separator && <ContextMenuSeparator className='my-1' />}
            </Fragment>
          ))}
        </ContextMenuContent>
      </ContextMenu>

      <UpdateCheckDialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen} />
    </>
  )
})
