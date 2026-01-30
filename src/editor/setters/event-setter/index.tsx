import { AlertModal } from '@/components/common/AlertModal'
import { Button } from '@/components/ui/button'
import { DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { JSFunction, SetterProps } from '@easy-editor/core'
import { Settings, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EventBindModal, type EventBindModalProps, type Tab } from './EventBindModal'

interface EventData {
  type: Tab
  name: string
  relatedEventName: string
  paramStr?: string
}

export interface Event {
  eventDataList?: EventData[]
  eventList?: Array<{
    name: string
    description?: string
    disabled?: boolean
  }>
}

interface EventSetterProps extends SetterProps<Event> {
  events: Array<{
    title: string
    children: Array<{
      label: string
      value: string
      description?: string
    }>
  }>
}

const EventSetter = (props: EventSetterProps) => {
  const { value, onChange, events, field } = props
  const node = field.nodes[0]
  const methods = node.document?.rootNode?.getExtraPropValue('methods') as Record<string, JSFunction>

  // 这里需要使用 key 来触发重新渲染，让 select 保持 undefined
  const [openKey, setOpenKey] = useState(0)
  const [open, setOpen] = useState(false)
  const [eventName, setEventName] = useState<string | undefined>(undefined)
  const [editEventName, setEditEventName] = useState<string | undefined>(undefined)
  const releatedEventName = useMemo(() => {
    return value?.eventDataList?.find(item => item.name === editEventName)?.relatedEventName
  }, [editEventName, value?.eventDataList])

  const handleValueChange = (value: string) => {
    setOpenKey(prev => prev + 1)
    setOpen(true)
    setEventName(value)
  }

  // 生成事件处理函数
  const generateEventHandler = (relatedEventName: string, paramStr?: string): JSFunction => {
    const params = paramStr ? `[${paramStr}]` : '[]'
    return {
      type: 'JSFunction',
      value: `function(){return this.${relatedEventName}.apply(this,Array.prototype.slice.call(arguments).concat(${params})) }`,
    }
  }

  const handleModalConfirm: EventBindModalProps['onConfirm'] = param => {
    if (!eventName) {
      return
    }

    const newEventData: any = {
      type: param.kind,
      name: eventName,
      relatedEventName: param.event,
    }

    if (param.extendParam) {
      newEventData.paramStr = param.extendParam
    }

    // 生成事件处理函数并设置到节点上
    const eventHandler = generateEventHandler(param.event, param.extendParam)
    node.setPropValue(eventName, eventHandler)

    // 编辑
    if (editEventName) {
      onChange?.({
        ...value,
        eventDataList: value?.eventDataList?.map(item => (item.name === editEventName ? newEventData : item)),
      })
      setEditEventName(undefined)
    }
    // 新增
    else {
      // 从 events 配置中获取 description
      const eventConfig = events.flatMap(e => e.children).find(c => c.value === eventName)

      onChange?.({
        eventDataList: [...(value?.eventDataList || []), newEventData],
        eventList: [
          ...(value?.eventList || []),
          {
            name: newEventData.name,
            description: eventConfig?.description,
            disabled: true,
          },
        ],
      })
      setEventName(undefined)
    }
  }

  const handleDeleteEvent = (eventData: EventData) => {
    // 删除节点上的事件处理函数
    node.clearPropValue(eventData.name)

    onChange?.({
      eventDataList: value?.eventDataList?.filter(item => item.name !== eventData.name),
      eventList: value?.eventList?.filter(item => item.name !== eventData.name),
    })
  }

  const handleEditEvent = (eventData: EventData) => {
    setOpen(true)
    setEventName(eventData.name)
    setEditEventName(eventData.name)
  }

  return (
    <EventBindModal
      open={open}
      setOpen={setOpen}
      methods={methods}
      onConfirm={handleModalConfirm}
      method={releatedEventName}
    >
      <div className='flex flex-col gap-3 w-full'>
        {/* 上方：事件选择 */}
        <div className='flex gap-2 w-full'>
          {events.map((event, index) => (
            <Select key={`${event.title}-${openKey}-${index}`} value={undefined} onValueChange={handleValueChange}>
              <SelectTrigger className='flex-1 h-7 text-xs justify-between'>
                <SelectValue placeholder={event.title} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {event.children.map(child => (
                    <DialogTrigger key={child.value} asChild>
                      <SelectItem
                        value={child.value}
                        disabled={value?.eventDataList?.some(item => item.name === child.value)}
                        className='flex justify-between items-center gap-2'
                      >
                        <span>{child.label}</span>
                        {child.description && (
                          <span className='text-[11px] text-muted-foreground'>{child.description}</span>
                        )}
                      </SelectItem>
                    </DialogTrigger>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ))}
        </div>

        {/* 下方：已有事件表格 */}
        <div className='w-full'>
          {value?.eventDataList && value.eventDataList.length > 0 ? (
            <Table className='m-0'>
              <TableHeader>
                <TableRow>
                  <TableHead className='text-[11px] font-medium px-2 py-1.5 h-auto'>已有事件</TableHead>
                  <TableHead className='text-[11px] font-medium px-2 py-1.5 h-auto'>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {value.eventDataList.map(eventData => (
                  <TableRow key={eventData.name}>
                    <TableCell className='text-xs px-2 py-1.5'>
                      <span className='font-medium'>{eventData.name}</span>
                      <span className='px-2 text-muted-foreground'>→</span>
                      <Button
                        variant='link'
                        className='text-xs p-0 h-auto text-primary hover:underline'
                        onClick={() => handleEditEvent(eventData)}
                      >
                        {eventData.relatedEventName}
                      </Button>
                    </TableCell>
                    <TableCell className='flex items-center gap-2'>
                      <Settings
                        className='w-4 h-4 cursor-pointer text-muted-foreground transition-colors hover:text-foreground'
                        onClick={() => handleEditEvent(eventData)}
                      />
                      <AlertModal
                        title='确定删除吗？'
                        description='删除后，该事件绑定将无法恢复。'
                        trigger={
                          <Trash2 className='w-4 h-4 cursor-pointer text-muted-foreground transition-colors hover:text-destructive' />
                        }
                        onConfirm={() => handleDeleteEvent(eventData)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className='flex flex-col items-center justify-center p-4 text-muted-foreground text-[11px] border border-dashed border-border rounded-md'>
              <span>暂无事件绑定</span>
            </div>
          )}
        </div>
      </div>
    </EventBindModal>
  )
}

export default EventSetter
