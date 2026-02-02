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
import { project } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { Fragment, type PropsWithChildren, useState } from 'react'
import { UpdateCheckDialog } from '../dialogs/UpdateCheckDialog'
import { getMenuItems } from './menuConfig'
import type { MenuItem } from './types'
import { SelectionType } from './types'

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
  const filteredMenuItems = getMenuItems(selectionType)

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
          {filteredMenuItems.map(item => (
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

export { SelectionType } from './types'
export type { MenuItem } from './types'
