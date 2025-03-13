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
import { Fragment, type PropsWithChildren } from 'react'

interface MenuItem {
  key: string
  label: string
  children?: MenuItem[]
  separator?: boolean
  shortcut?: string
}

const menuItems: MenuItem[] = [
  {
    key: 'layer',
    label: '图层',
    children: [
      {
        key: 'layer-top',
        label: '置顶',
      },
      {
        key: 'layer-bottom',
        label: '置底',
      },
      {
        key: 'layer-up',
        label: '上移一层',
      },
      {
        key: 'layer-down',
        label: '下移一层',
      },
    ],
  },
  {
    key: 'group',
    label: '成组',
  },
  {
    key: 'ungroup',
    label: '取消成组',
    separator: true,
  },
  {
    key: 'copy',
    label: '复制',
  },
  {
    key: 'paste',
    label: '粘贴',
  },
  {
    key: 'copy-paste-as',
    label: '...复制/粘贴为',
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
  },
  {
    key: 'lock',
    label: '锁定',
    separator: true,
  },
  {
    key: 'delete',
    label: '删除',
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
                <ContextMenuSubTrigger inset>
                  {item.label}
                  {item.shortcut && <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className='w-48'>
                  {item.children.map(child => (
                    <Fragment key={child.key}>
                      <ContextMenuItem>
                        {child.label}
                        {child.shortcut && <ContextMenuShortcut>{child.shortcut}</ContextMenuShortcut>}
                      </ContextMenuItem>
                      {child.separator && <ContextMenuSeparator />}
                    </Fragment>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : (
              <ContextMenuItem inset key={item.key}>
                {item.label}
                {item.shortcut && <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>}
              </ContextMenuItem>
            )}
            {item.separator && <ContextMenuSeparator />}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
