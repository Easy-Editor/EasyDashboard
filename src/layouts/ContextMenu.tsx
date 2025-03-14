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
import { designer } from '@/editor'
import {
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
  Trash2,
  Ungroup,
} from 'lucide-react'
import { Fragment, type PropsWithChildren } from 'react'

interface MenuItem {
  key: string
  label: string
  icon?: React.ComponentType
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
      },
      {
        key: 'layer-bottom',
        label: '置底',
        icon: PanelBottom,
      },
      {
        key: 'layer-up',
        label: '上移一层',
        icon: ArrowUp,
      },
      {
        key: 'layer-down',
        label: '下移一层',
        icon: ArrowDown,
      },
    ],
  },
  {
    key: 'group',
    label: '成组',
    icon: Group,
  },
  {
    key: 'ungroup',
    label: '取消成组',
    icon: Ungroup,
    separator: true,
  },
  {
    key: 'copy',
    label: '复制',
    icon: ClipboardCopy,
    shortcut: '⌘C',
  },
  {
    key: 'paste',
    label: '粘贴',
    icon: ClipboardPaste,
    shortcut: '⌘V',
  },
  {
    key: 'cv',
    label: '拷贝',
    icon: ClipboardPen,
    onClick() {
      const selected = designer.selection.getTopNodes()
      if (selected.length === 0) return

      for (const node of selected) {
        if (node.isRoot) continue

        const document = node.document
        const cloneNodeSchema = node.export()
        // 添加偏移
        cloneNodeSchema.$dashboard!.rect!.x = (cloneNodeSchema.$dashboard!.rect!.x ?? 0) + 10
        cloneNodeSchema.$dashboard!.rect!.y = (cloneNodeSchema.$dashboard!.rect!.y ?? 0) + 10
        // 插入
        document.insertNode(node.parent!, cloneNodeSchema, node.index + 1)
      }
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
    key: 'hide',
    label: '隐藏',
    icon: Eye,
    shortcut: '⌘⇧H',
  },
  {
    key: 'lock',
    label: '锁定',
    icon: Lock,
    shortcut: '⌘⇧L',
    separator: true,
  },
  {
    key: 'delete',
    label: '删除',
    icon: Trash2,
    shortcut: 'Del',
  },
]

interface RendererContextMenuProps extends PropsWithChildren {}

export const RendererContextMenu = ({ children }: RendererContextMenuProps) => {
  return (
    <ContextMenu>
      <ContextMenuTrigger className='w-full h-full'>{children}</ContextMenuTrigger>
      <ContextMenuContent className='w-64'>
        {menuItems.map(item => (
          <Fragment key={item.key}>
            {item.children ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger className='text-xs h-8 px-2'>
                  {item.icon && <item.icon className='w-4 h-4 mr-2' />}
                  {item.label}
                  {item.shortcut && <ContextMenuShortcut className='text-xs'>{item.shortcut}</ContextMenuShortcut>}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className='w-48 text-xs'>
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
              <ContextMenuItem key={item.key} className='h-8 px-2 text-xs gap-0' onClick={item?.onClick}>
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
  )
}
