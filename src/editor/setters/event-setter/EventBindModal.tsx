import { CodeEditor } from '@/components/common/code-editor'
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
import { Switch } from '@/components/ui/switch'
import { normalizeExtraPropRecord } from '@/editor/extra-prop-record'
import { cn } from '@/lib/utils'
import type { JSFunction } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { type PropsWithChildren, useEffect, useMemo, useState } from 'react'

export enum Tab {
  BUILTIN = 'builtin',
  COMPONENT = 'componentEvent',
}

const tabList = [
  {
    label: '内置函数',
    value: Tab.BUILTIN,
  },
  {
    label: '组件事件',
    value: Tab.COMPONENT,
  },
]

const builtinMethods: Record<string, JSFunction> = {
  'utils.navigate': {
    type: 'JSFunction',
    value: '',
    description: '跳转页面',
  },
}

const defaultExtendParam = '{\n  "name": "test" \n}'

export interface EventBindModalProps extends PropsWithChildren {
  methods?: Record<string, JSFunction> | null
  open: boolean
  setOpen: (open: boolean) => void
  onConfirm?: (param: { kind: Tab; event: string; method: JSFunction; extendParam?: string }) => void
  method?: string
}

export const EventBindModal = observer((props: EventBindModalProps) => {
  const { open, onConfirm, setOpen, children, methods, method } = props
  const [tab, setTab] = useState<Tab>(Tab.COMPONENT)
  const [event, setEvent] = useState<string | undefined>(method)
  const [enabledExtendParam, setEnabledExtendParam] = useState(false)
  const [extendParam, setExtendParam] = useState<string | undefined>(defaultExtendParam)

  const currentMethods = useMemo(() => {
    if (tab === Tab.BUILTIN) {
      return builtinMethods
    }
    return normalizeExtraPropRecord(methods)
  }, [tab, methods])

  const handleConfirm = () => {
    if (!event) {
      return console.error('event is required')
    }

    const param: any = {
      kind: tab,
      event,
      method: currentMethods[event],
    }

    if (enabledExtendParam) {
      param.extendParam = extendParam
    }

    onConfirm?.(param)
    setOpen(false)
  }

  useEffect(() => {
    if (method) {
      setEvent(method)
    }
  }, [method])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children}
      <DialogContent data-ed-shell='editor' className='max-w-[800px]!'>
        <DialogHeader>
          <DialogTitle>事件绑定</DialogTitle>
          <DialogDescription asChild>
            <div className='flex gap-6 text-xs min-h-[360px]'>
              {/* 左侧：事件选择 */}
              <div className='flex flex-col gap-2 w-[300px] shrink-0'>
                <div className='text-xs font-semibold text-foreground'>事件选择</div>
                <div className='flex border border-border rounded-md overflow-hidden flex-1'>
                  {/* Tab 列表 */}
                  <div className='flex flex-col w-[90px] shrink-0 border-r border-border bg-muted'>
                    {tabList.map(item => (
                      <div
                        key={item.value}
                        className={cn(
                          'flex items-center px-2.5 py-1.5 text-xs cursor-pointer transition-all text-muted-foreground border-l-2 border-transparent hover:bg-accent hover:text-foreground',
                          tab === item.value && 'bg-background text-foreground font-medium !border-l-primary',
                        )}
                        onClick={() => {
                          setTab(item.value)
                          setEvent(undefined)
                        }}
                      >
                        {item.label}
                      </div>
                    ))}
                  </div>
                  {/* 方法列表 */}
                  <div className='flex flex-col flex-1 min-w-0 max-h-80 overflow-y-auto'>
                    {Object.entries(currentMethods).map(([key, value]) => (
                      <div
                        key={key}
                        className={cn(
                          'flex flex-col px-2.5 py-1.5 cursor-pointer transition-all border-l-2 border-transparent border-b border-border last:border-b-0 hover:bg-accent',
                          event === key && 'bg-accent !border-l-primary',
                        )}
                        onClick={() => setEvent(key)}
                      >
                        <span className='text-xs font-medium text-foreground'>{key}</span>
                        {value?.description && (
                          <span className='text-[11px] text-muted-foreground mt-0.5'>{value.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 右侧：配置区 */}
              <div className='flex-1 flex flex-col gap-3 min-w-0 pl-6 border-l border-border'>
                <div className='text-xs font-semibold text-foreground'>配置信息</div>
                <div className='flex flex-col gap-1.5'>
                  <div className='text-xs font-semibold text-foreground'>事件名称</div>
                  <Input className='h-8 text-xs' value={event || ''} disabled />
                </div>
                <div className='flex items-center gap-3 mt-2'>
                  <div className='text-xs font-semibold text-foreground'>扩展参数设置</div>
                  <Switch checked={enabledExtendParam} onCheckedChange={setEnabledExtendParam} />
                </div>
                <div className='relative flex-1 min-h-[180px] border border-border rounded-md overflow-hidden'>
                  <CodeEditor
                    language='json'
                    value={extendParam}
                    onChange={setExtendParam}
                    options={{ readOnly: !enabledExtendParam }}
                  />
                  {!enabledExtendParam && (
                    <div className='absolute inset-0 bg-muted opacity-60 cursor-not-allowed z-10' />
                  )}
                </div>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)} className='h-8 text-xs px-4'>
            取消
          </Button>
          <Button type='submit' onClick={handleConfirm} className='h-8 text-xs px-4' disabled={!event}>
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
