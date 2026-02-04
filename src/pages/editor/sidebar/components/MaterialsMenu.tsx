/**
 * Materials Menu
 * 物料管理下拉菜单 - 整合本地调试和远程组件入口
 */

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { localLoader } from '@/editor/remote'
import { Cloud, Plug, Settings } from 'lucide-react'
import { observer } from 'mobx-react'
import { useCallback, useEffect, useState } from 'react'
import { LocalMaterialDebugDialog } from './LocalMaterialDebugDialog'
import { RemoteMaterialDialog } from './RemoteMaterialDialog'

export const MaterialsMenu = observer(() => {
  const [localDebugOpen, setLocalDebugOpen] = useState(false)
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false)
  const [connectionCount, setConnectionCount] = useState(0)

  // 更新连接数量
  const updateConnectionCount = useCallback(() => {
    setConnectionCount(localLoader.getConnections().length)
  }, [])

  // 监听连接事件
  useEffect(() => {
    const handleConnected = () => updateConnectionCount()
    const handleDisconnected = () => updateConnectionCount()

    localLoader.on('connected', handleConnected)
    localLoader.on('disconnected', handleDisconnected)

    // 初始化时更新连接数量
    updateConnectionCount()

    return () => {
      localLoader.off('connected', handleConnected)
      localLoader.off('disconnected', handleDisconnected)
    }
  }, [updateConnectionCount])

  const hasConnections = connectionCount > 0

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline' size='sm' className={hasConnections ? 'border-green-500' : ''}>
            <Settings className='mr-1 h-4 w-4' />
            物料
            {hasConnections && <span className='ml-1.5 h-2 w-2 rounded-full bg-green-500 animate-pulse' />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={() => setLocalDebugOpen(true)}>
            <Plug className='mr-2 h-4 w-4' />
            本地调试
            {hasConnections && <span className='ml-auto text-xs text-green-600'>({connectionCount})</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRemoteDialogOpen(true)}>
            <Cloud className='mr-2 h-4 w-4' />
            添加远程组件
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs */}
      <LocalMaterialDebugDialog open={localDebugOpen} onOpenChange={setLocalDebugOpen} />
      <RemoteMaterialDialog open={remoteDialogOpen} onOpenChange={setRemoteDialogOpen} />
    </>
  )
})

export default MaterialsMenu
