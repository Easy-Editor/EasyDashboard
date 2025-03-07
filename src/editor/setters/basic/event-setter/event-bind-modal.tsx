import { CodeEditor } from '@/components/common/CodeEditor'
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
import { cn } from '@/lib/utils'
import type { JSFunction } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { type PropsWithChildren, useMemo, useState } from 'react'

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

const defaultExtendParam = '{\n  "name": "test" \n}'

export interface EventBindModalProps extends PropsWithChildren {
  methods: Record<string, JSFunction>
  open: boolean
  setOpen: (open: boolean) => void
  onConfirm?: (param: { kind: Tab; event: string; method: JSFunction; extendParam?: string }) => void
}

const EventBindModal = observer((props: EventBindModalProps) => {
  const { open, onConfirm, setOpen, children, methods } = props
  const [tab, setTab] = useState<Tab>(Tab.COMPONENT)
  const [event, setEvent] = useState<string | undefined>(undefined)
  const [enabledExtendParam, setEnabledExtendParam] = useState(false)
  const [extendParam, setExtendParam] = useState<string | undefined>(defaultExtendParam)

  const currentMethods = useMemo(() => {
    if (tab === Tab.BUILTIN) {
      return {}
    }
    return methods
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children}
      <DialogContent className='!max-w-[800px]'>
        <DialogHeader>
          <DialogTitle>事件绑定</DialogTitle>
          <DialogDescription className='mt-2'>
            <div className='flex gap-4 text-xs h-[400px]'>
              <div className='flex flex-col gap-2'>
                <div className='font-bold'>事件选择</div>
                <div className='flex border-[1px] h-full'>
                  <div className='flex flex-col w-[100px] border-r-[1px]'>
                    {tabList.map(item => (
                      <div
                        key={item.value}
                        className={cn(
                          'w-full h-7 flex items-center pl-2 cursor-pointer',
                          tab === item.value && 'bg-accent/70',
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
                  <div className='flex flex-col w-[150px]'>
                    {Object.keys(currentMethods).map(key => (
                      <div
                        key={key}
                        className={cn(
                          'w-full h-7 flex items-center pl-2 cursor-pointer',
                          event === key && 'bg-accent/70',
                        )}
                        onClick={() => setEvent(key)}
                      >
                        {key}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className='flex-1 flex flex-col gap-2'>
                <div className='font-bold'>事件名称</div>
                <Input className='h-8 !text-xs px-2 py-[5px]' value={event} disabled />
                <div className='flex gap-4 mt-2'>
                  <div className='font-bold'>扩展参数设置</div>
                  <Switch checked={enabledExtendParam} onCheckedChange={setEnabledExtendParam} />
                </div>
                <div className='relative w-full h-full'>
                  <CodeEditor
                    language='json'
                    value={extendParam}
                    onChange={setExtendParam}
                    options={{ readOnly: !enabledExtendParam }}
                  />
                  {!enabledExtendParam && (
                    <div
                      className='absolute inset-0 bg-white/50 dark:bg-black/50 cursor-not-allowed'
                      aria-label='Editor disabled'
                      role='button'
                      tabIndex={0}
                      aria-disabled
                      onKeyDown={e => e.preventDefault()}
                    />
                  )}
                </div>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type='submit' onClick={handleConfirm} className='h-8 text-xs px-4 py-[5px]'>
            确定
          </Button>
          <Button variant='outline' onClick={() => setOpen(false)} className='h-8 text-xs px-4 py-[5px]'>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

export default EventBindModal
