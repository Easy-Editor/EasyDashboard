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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { JSExpression, SettingField } from '@easy-editor/core'
import { SquareCode } from 'lucide-react'
import { observer } from 'mobx-react'
import { useMemo, useState } from 'react'

export enum Tab {
  BUILTIN = 'builtin',
  STATE = 'state',
}

const tabList = [
  {
    label: '内置',
    value: Tab.BUILTIN,
  },
  {
    label: 'STATE',
    value: Tab.STATE,
  },
]

const builtinState: Record<string, JSExpression> = {}

export interface VariableBindProps {
  field: SettingField
}

export const VariableBind = observer((props: VariableBindProps) => {
  const { field } = props
  const state = field.designer?.currentDocument?.rootNode?.getExtraPropValue('state') as Record<string, JSExpression>
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>(Tab.STATE)
  const [value, setValue] = useState('')

  const currentState = useMemo(() => {
    if (tab === Tab.BUILTIN) {
      return builtinState
    }
    return state
  }, [tab, state])

  const addVariable = (key: string) => {
    const computed = `this.${tab}.${key}`
    setValue(prev => prev + computed)
  }

  const handleConfirm = () => {
    if (!value) {
      return console.error('value is required')
    }

    console.log(value, field)
    // const param: any = {
    //   kind: tab,
    //   event,
    //   method: currentState[event],
    // }
    // setOpen(false)
    // field.setValue(value, true)
    field.setValue({
      type: 'JSExpression',
      value,
    } as JSExpression)
    console.log('node', field.getNode().export())
  }

  // useEffect(() => {
  //   if (method) {
  //     setEvent(method)
  //   }
  // }, [method])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <SquareCode className='w-4 h-4 text-gray-500 cursor-pointer' onClick={() => setOpen(true)} />
          </TooltipTrigger>
          <TooltipContent>
            <p>变量绑定</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent className='!max-w-[800px]'>
        <DialogHeader>
          <DialogTitle>变量绑定</DialogTitle>
          <DialogDescription className='mt-2'>
            <div className='flex gap-4 text-xs h-[400px]'>
              <div className='flex flex-col gap-2'>
                <div className='font-bold'>状态选择</div>
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
                        }}
                      >
                        {item.label}
                      </div>
                    ))}
                  </div>
                  <div className='flex flex-col w-[150px]'>
                    {Object.entries(currentState).map(([key, value]) => (
                      <div
                        key={key}
                        className={cn('w-full h-7 flex items-center pl-2 cursor-pointer')}
                        onClick={() => addVariable(key)}
                      >
                        <div className='flex items-center gap-1'>
                          <span>{key}</span>
                          {value.description && <span className='text-xs text-gray-500'>({value.description})</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className='flex-1 flex flex-col gap-2'>
                <div className='font-bold'>绑定</div>
                <div className='relative w-full h-full'>
                  <CodeEditor language='js' value={value} onChange={setValue} />
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
