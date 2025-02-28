import { CodeEditor } from '@/components/code-editor'
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
import { type PropsWithChildren, useState } from 'react'

enum Tab {
  BUILTIN = 'builtin',
  COMPONENT = 'component',
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

interface EventBindModalProps extends PropsWithChildren {
  open: boolean
  onConfirm?: (event: string, extendParam: string) => void
  onClose?: () => void
}

const EventBindModal = (props: EventBindModalProps) => {
  const { open, onConfirm, onClose, children } = props
  const [tab, setTab] = useState<Tab>(Tab.COMPONENT)
  const [event, setEvent] = useState<string | undefined>(undefined)
  const [enabledExtendParam, setEnabledExtendParam] = useState(false)
  const [extendParam, setExtendParam] = useState<string | undefined>('{\n  "name": "test" \n}')

  return (
    <Dialog open={open}>
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
                        onClick={() => setTab(item.value)}
                      >
                        {item.label}
                      </div>
                    ))}
                  </div>
                  <div className='flex flex-col w-[150px]'>
                    <div className='w-full h-7 flex items-center pl-2 cursor-pointer bg-accent/70'>textFunc</div>
                    <div className='w-full h-7 flex items-center pl-2 cursor-pointer'>textFunc</div>
                    <div className='w-full h-7 flex items-center pl-2 cursor-pointer'>textFunc</div>
                    <div className='w-full h-7 flex items-center pl-2 cursor-pointer'>textFunc</div>
                  </div>
                </div>
              </div>
              <div className='flex-1 flex flex-col gap-2'>
                <div className='font-bold'>事件名称</div>
                <Input className='h-8 !text-xs px-2 py-[5px]' value={'textFunc'} disabled />
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
          <Button type='submit' onClick={() => onConfirm(event, extendParam)} className='h-8 text-xs px-4 py-[5px]'>
            确定
          </Button>
          <Button variant='outline' onClick={onClose} className='h-8 text-xs px-4 py-[5px]'>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default EventBindModal
