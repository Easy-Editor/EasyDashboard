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
import {
  ArrowDown,
  ArrowUp,
  Clipboard,
  ClipboardCopy,
  ClipboardPaste,
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
                      <ContextMenuItem className='h-8 px-2 text-xs gap-0'>
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
              <ContextMenuItem key={item.key} className='h-8 px-2 text-xs gap-0'>
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
