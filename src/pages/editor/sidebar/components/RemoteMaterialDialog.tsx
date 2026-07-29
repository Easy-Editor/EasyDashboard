/**
 * Remote Material Dialog
 * 远程物料管理对话框 - 从 NPM/CDN 动态加载物料组件
 */

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { RemoteLoadError, materialManager, remoteMaterialsConfig } from '@/editor/remote'
import type { RemoteMaterialConfig } from '@/editor/remote'
import { Check, Loader2, Package, Plus, Trash2, X } from 'lucide-react'
import { observer } from 'mobx-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

interface RemoteMaterialDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export const RemoteMaterialDialog = observer(({ open, onOpenChange }: RemoteMaterialDialogProps) => {
  const [configs, setConfigs] = useState<RemoteMaterialConfig[]>(remoteMaterialsConfig)
  const [loading, setLoading] = useState(false)
  const [removingKeys, setRemovingKeys] = useState<Set<string>>(new Set())

  // 配置操作
  const handleToggle = useCallback((index: number) => {
    setConfigs(prev => {
      const next = [...prev]
      next[index] = { ...next[index], enabled: !next[index].enabled }
      return next
    })
  }, [])

  const handleChange = useCallback((index: number, field: keyof RemoteMaterialConfig, value: string | boolean) => {
    setConfigs(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }, [])

  const handleAddConfig = useCallback(() => {
    setConfigs(prev => [
      ...prev,
      {
        package: '',
        version: 'latest',
        globalName: '',
        enabled: true,
      },
    ])
  }, [])

  const handleRemoveConfig = useCallback((index: number) => {
    setConfigs(prev => prev.filter((_, i) => i !== index))
  }, [])

  // 加载操作
  const handleLoadAll = useCallback(async () => {
    setLoading(true)
    try {
      const enabledConfigs = configs.filter(c => c.enabled && c.package)
      const result = await materialManager.loadMaterialMultiple(enabledConfigs)

      if (result.succeeded > 0) {
        toast.success(`成功加载 ${result.succeeded} 个远程物料`, {
          description: result.failed > 0 ? `失败: ${result.failed} 个` : undefined,
        })
      } else if (result.failed > 0) {
        toast.error('所有物料加载失败')
      }

      // 显示详细错误
      result.results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const material = enabledConfigs[i]
          const error = r.reason
          toast.error(`${material.package} 加载失败`, {
            description: error instanceof RemoteLoadError ? error.toUserMessage() : String(error),
          })
        }
      })
    } finally {
      setLoading(false)
    }
  }, [configs])

  // 删除已加载物料
  const handleRemoveLoaded = useCallback(async (packageName: string, version: string) => {
    const key = `${packageName}@${version}`
    setRemovingKeys(prev => new Set(prev).add(key))

    try {
      const result = await materialManager.removeMaterial(packageName, version, { force: true })
      if (result.success) {
        toast.success(`已删除 ${packageName}@${version}`)
      } else {
        toast.error(`删除失败: ${result.reason}`)
      }
    } catch (error) {
      toast.error(`删除失败: ${error}`)
    } finally {
      setRemovingKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [])

  const loadedMaterials = materialManager.getLoadedPackages()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-4xl max-h-[85vh] gap-4'>
        <DialogHeader className='space-y-1'>
          <DialogTitle className='text-lg font-semibold tracking-tight'>远程物料管理</DialogTitle>
          <DialogDescription className='text-sm text-muted-foreground'>从 NPM/CDN 动态加载物料组件</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue='config' className='w-full'>
          <TabsList className='grid w-full grid-cols-2 h-9'>
            <TabsTrigger value='config' className='text-sm'>
              配置列表
              <span className='ml-1.5 text-xs text-muted-foreground'>({configs.length})</span>
            </TabsTrigger>
            <TabsTrigger value='loaded' className='text-sm'>
              已加载
              <span className='ml-1.5 text-xs text-muted-foreground'>({loadedMaterials.length})</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value='config' className='mt-3'>
            <ConfigurationTable
              configs={configs}
              onToggle={handleToggle}
              onChange={handleChange}
              onRemove={handleRemoveConfig}
            />
          </TabsContent>

          <TabsContent value='loaded' className='mt-3'>
            <LoadedMaterialsTable
              materials={loadedMaterials}
              removingKeys={removingKeys}
              onRemove={handleRemoveLoaded}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className='gap-2 sm:gap-2 pt-2 border-t'>
          <Button variant='outline' size='sm' onClick={handleAddConfig}>
            <Plus className='mr-1.5 h-3.5 w-3.5' />
            添加配置
          </Button>
          <Button size='sm' onClick={handleLoadAll} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                加载中...
              </>
            ) : (
              '加载全部'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

// ===== 配置表格组件 =====

interface ConfigurationTableProps {
  configs: RemoteMaterialConfig[]
  onToggle: (index: number) => void
  onChange: (index: number, field: keyof RemoteMaterialConfig, value: string | boolean) => void
  onRemove: (index: number) => void
}

const ConfigurationTable = ({ configs, onToggle, onChange, onRemove }: ConfigurationTableProps) => (
  <ScrollArea className='h-[45vh] rounded-md border'>
    <Table>
      <TableHeader className='sticky top-0 bg-background z-10'>
        <TableRow className='hover:bg-transparent'>
          <TableHead className='w-[38%] h-9 text-xs font-medium'>包名</TableHead>
          <TableHead className='w-[14%] h-9 text-xs font-medium'>版本</TableHead>
          <TableHead className='w-[28%] h-9 text-xs font-medium'>全局名</TableHead>
          <TableHead className='w-[10%] h-9 text-xs font-medium text-center'>启用</TableHead>
          <TableHead className='w-[10%] h-9 text-xs font-medium' />
        </TableRow>
      </TableHeader>
      <TableBody>
        {configs.map((config, index) => (
          <TableRow key={index} className='group'>
            <TableCell className='py-1.5'>
              <Input
                placeholder='@easy-editor/materials-...'
                value={config.package}
                onChange={e => onChange(index, 'package', e.target.value)}
                className='h-8 text-xs font-mono bg-muted/30 border-transparent focus:border-input focus:bg-background transition-colors'
              />
            </TableCell>
            <TableCell className='py-1.5'>
              <Input
                placeholder='latest'
                value={config.version}
                onChange={e => onChange(index, 'version', e.target.value)}
                className='h-8 text-xs font-mono bg-muted/30 border-transparent focus:border-input focus:bg-background transition-colors'
              />
            </TableCell>
            <TableCell className='py-1.5'>
              <Input
                placeholder='EasyEditorMaterials...'
                value={config.globalName}
                onChange={e => onChange(index, 'globalName', e.target.value)}
                className='h-8 text-xs font-mono bg-muted/30 border-transparent focus:border-input focus:bg-background transition-colors'
              />
            </TableCell>
            <TableCell className='py-1.5 text-center'>
              <Switch
                checked={config.enabled}
                onCheckedChange={() => onToggle(index)}
                className='data-[state=checked]:bg-primary'
              />
            </TableCell>
            <TableCell className='py-1.5'>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity'
                onClick={() => onRemove(index)}
              >
                <Trash2 className='h-3.5 w-3.5 text-muted-foreground hover:text-destructive transition-colors' />
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {configs.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className='h-32 text-center'>
              <div className='flex flex-col items-center gap-2 text-muted-foreground'>
                <Package className='h-8 w-8 opacity-50' />
                <span className='text-sm'>暂无配置</span>
                <span className='text-xs'>点击"添加配置"开始</span>
              </div>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  </ScrollArea>
)

// ===== 已加载物料表格组件 =====

interface LoadedMaterial {
  packageName: string
  version: string
  componentName: string
  hasComponent: boolean
}

interface LoadedMaterialsTableProps {
  materials: LoadedMaterial[]
  removingKeys: Set<string>
  onRemove: (packageName: string, version: string) => void
}

const LoadedMaterialsTable = ({ materials, removingKeys, onRemove }: LoadedMaterialsTableProps) => (
  <ScrollArea className='h-[45vh] rounded-md border'>
    <Table>
      <TableHeader className='sticky top-0 bg-background z-10'>
        <TableRow className='hover:bg-transparent'>
          <TableHead className='w-[35%] h-9 text-xs font-medium'>组件名</TableHead>
          <TableHead className='w-[35%] h-9 text-xs font-medium'>包名</TableHead>
          <TableHead className='w-[12%] h-9 text-xs font-medium'>版本</TableHead>
          <TableHead className='w-[10%] h-9 text-xs font-medium text-center'>状态</TableHead>
          <TableHead className='w-[8%] h-9 text-xs font-medium' />
        </TableRow>
      </TableHeader>
      <TableBody>
        {materials.map(material => {
          const key = `${material.packageName}@${material.version}`
          const isRemoving = removingKeys.has(key)

          return (
            <TableRow key={key} className='group'>
              <TableCell className='py-2'>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className='text-xs font-mono truncate block max-w-[200px]'>{material.componentName}</span>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='font-mono text-xs'>
                      {material.componentName}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableCell>
              <TableCell className='py-2'>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className='text-xs text-muted-foreground truncate block max-w-[200px]'>
                        {material.packageName}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='font-mono text-xs'>
                      {material.packageName}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableCell>
              <TableCell className='py-2'>
                <span className='inline-flex items-center text-xs bg-muted/60 px-2 py-0.5 rounded font-mono'>
                  v{material.version}
                </span>
              </TableCell>
              <TableCell className='py-2 text-center'>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className='inline-flex'>
                        {material.hasComponent ? (
                          <Check className='h-4 w-4 text-emerald-500' />
                        ) : (
                          <Package className='h-4 w-4 text-amber-500' />
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='text-xs'>
                      {material.hasComponent ? '组件已加载' : '仅元数据'}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableCell>
              <TableCell className='py-2'>
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity'
                  disabled={isRemoving}
                  onClick={() => onRemove(material.packageName, material.version)}
                >
                  {isRemoving ? (
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  ) : (
                    <X className='h-3.5 w-3.5 text-muted-foreground hover:text-destructive transition-colors' />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
        {materials.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className='h-32 text-center'>
              <div className='flex flex-col items-center gap-2 text-muted-foreground'>
                <Package className='h-8 w-8 opacity-50' />
                <span className='text-sm'>暂无已加载的远程物料</span>
                <span className='text-xs'>在配置列表中添加并加载物料</span>
              </div>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  </ScrollArea>
)

export default RemoteMaterialDialog
