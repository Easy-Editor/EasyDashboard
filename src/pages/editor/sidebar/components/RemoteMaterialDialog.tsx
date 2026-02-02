/**
 * Remote Material Dialog
 * 远程物料管理对话框 - 从 NPM/CDN 动态加载物料组件
 */

import { useState } from 'react'
import { observer } from 'mobx-react'
import { Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { materialManager, remoteMaterialsConfig, RemoteLoadError } from '@/editor/remote'
import { toast } from 'sonner'

// 版本比较函数
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0
    const part2 = parts2[i] || 0

    if (part1 > part2) return 1
    if (part1 < part2) return -1
  }

  return 0
}

interface RemoteMaterialDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export const RemoteMaterialDialog = observer(({ open, onOpenChange }: RemoteMaterialDialogProps) => {
  const [materials, setMaterials] = useState(remoteMaterialsConfig)
  const [loading, setLoading] = useState(false)

  const handleToggle = (index: number) => {
    const newMaterials = [...materials]
    newMaterials[index].enabled = !newMaterials[index].enabled
    setMaterials(newMaterials)
  }

  const handleLoadAll = async () => {
    setLoading(true)
    try {
      const result = await materialManager.loadMaterialMultiple(materials.filter(m => m.enabled))

      if (result.succeeded > 0) {
        toast.success(`成功加载 ${result.succeeded} 个远程物料`, {
          description: result.failed > 0 ? `失败: ${result.failed} 个` : undefined,
        })
      } else if (result.failed > 0) {
        toast.error('所有物料加载失败')
      }

      // 显示详细错误信息
      result.results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const material = materials.filter(m => m.enabled)[i]
          const error = r.reason

          if (error instanceof RemoteLoadError) {
            toast.error(`${material.package} 加载失败`, {
              description: error.toUserMessage(),
            })
          } else {
            toast.error(`${material.package} 加载失败`, {
              description: error instanceof Error ? error.message : String(error),
            })
          }
        }
      })
    } catch (error) {
      if (error instanceof RemoteLoadError) {
        toast.error('加载失败', {
          description: error.toUserMessage(),
        })
      } else {
        toast.error('加载失败', {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleAddMaterial = () => {
    setMaterials([
      ...materials,
      {
        package: '',
        version: 'latest',
        globalName: '',
        enabled: true,
      },
    ])
  }

  const handleRemove = (index: number) => {
    const newMaterials = materials.filter((_, i) => i !== index)
    setMaterials(newMaterials)
  }

  const handleChange = (index: number, field: keyof (typeof materials)[0], value: string | boolean) => {
    const newMaterials = [...materials]
    newMaterials[index] = { ...newMaterials[index], [field]: value }
    setMaterials(newMaterials)
  }

  const loadedMaterials = materialManager.getLoadedMaterials()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl max-h-[80vh]'>
        <DialogHeader>
          <DialogTitle>远程物料管理</DialogTitle>
          <DialogDescription>从 NPM/CDN 动态加载物料组件</DialogDescription>
        </DialogHeader>

        <ScrollArea className='max-h-[50vh] pr-4'>
          <div className='space-y-4'>
            {/* 物料配置列表 */}
            {materials.map((material, index) => (
              <div key={index} className='flex items-end gap-2 rounded-lg border p-3'>
                <div className='flex-1 space-y-2'>
                  <div>
                    <Label htmlFor={`package-${index}`}>Package Name</Label>
                    <Input
                      id={`package-${index}`}
                      placeholder='@easy-editor/materials-dashboard-text'
                      value={material.package}
                      onChange={e => handleChange(index, 'package', e.target.value)}
                    />
                  </div>
                  <div className='grid grid-cols-2 gap-2'>
                    <div>
                      <Label htmlFor={`version-${index}`}>Version</Label>
                      <Input
                        id={`version-${index}`}
                        placeholder='latest'
                        value={material.version}
                        onChange={e => handleChange(index, 'version', e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`globalName-${index}`}>Global Name</Label>
                      <Input
                        id={`globalName-${index}`}
                        placeholder='EasyEditorMaterialsText'
                        value={material.globalName}
                        onChange={e => handleChange(index, 'globalName', e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className='flex items-center gap-2'>
                  <Switch checked={material.enabled} onCheckedChange={() => handleToggle(index)} />
                  <Button variant='ghost' size='icon' onClick={() => handleRemove(index)}>
                    <Trash2 className='h-4 w-4 text-muted-foreground' />
                  </Button>
                </div>
              </div>
            ))}

            {/* 已加载的物料 */}
            {loadedMaterials.length > 0 && (
              <div className='border-t pt-4'>
                <h4 className='mb-2 text-sm font-semibold'>已加载的远程物料：</h4>
                <div className='space-y-1'>
                  {(() => {
                    // 按基础组件名分组，显示所有版本
                    const groupedMaterials = new Map<string, typeof loadedMaterials>()

                    loadedMaterials.forEach(m => {
                      const componentName = m.metadata.componentName
                      const baseComponentName = componentName.includes('@')
                        ? componentName.split('@')[0]
                        : componentName

                      if (!groupedMaterials.has(baseComponentName)) {
                        groupedMaterials.set(baseComponentName, [])
                      }
                      groupedMaterials.get(baseComponentName)!.push(m)
                    })

                    return Array.from(groupedMaterials.entries()).map(([baseName, materials]) => {
                      // 按版本号排序
                      const sortedMaterials = materials.sort((a, b) => {
                        const versionA = a.metadata.componentName.split('@')[1] || '0.0.0'
                        const versionB = b.metadata.componentName.split('@')[1] || '0.0.0'
                        return compareVersions(versionB, versionA) // 降序
                      })

                      return (
                        <div key={baseName} className='text-sm'>
                          <span className='font-medium'>{baseName}</span>
                          <span className='text-muted-foreground ml-2'>
                            (
                            {sortedMaterials
                              .map(m => {
                                const version = m.metadata.componentName.split('@')[1] || 'unknown'
                                return `v${version}`
                              })
                              .join(', ')}
                            )
                          </span>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className='gap-2 sm:gap-0'>
          <Button variant='outline' onClick={handleAddMaterial}>
            添加物料
          </Button>
          <Button onClick={handleLoadAll} disabled={loading}>
            {loading ? '加载中...' : '加载全部'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

export default RemoteMaterialDialog
