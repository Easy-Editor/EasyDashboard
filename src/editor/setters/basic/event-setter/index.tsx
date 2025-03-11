import { AlertModal } from '@/components/common/AlertModal'
import { Button } from '@/components/ui/button'
import { DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { JSFunction, SetterProps } from '@easy-editor/core'
import { Settings, Trash } from 'lucide-react'
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
  const methods = field.designer?.currentDocument?.rootNode?.getExtraPropValue('methods') as Record<string, JSFunction>
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
      onChange?.({
        eventDataList: [...(value?.eventDataList || []), newEventData],
        eventList: [...(value?.eventList || []), { name: newEventData.name }],
      })
      setEventName(undefined)
    }
  }

  const handleDeleteEvent = (eventData: EventData) => {
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
      <div className='flex flex-col w-full'>
        {events.map((event, index) => (
          <Select key={`${event.title}-${openKey}-${index}`} value={undefined} onValueChange={handleValueChange}>
            <SelectTrigger className='w-full justify-center [&>svg]:hidden text-xs'>
              <SelectValue placeholder={event.title} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {event.children.map(child => (
                  <DialogTrigger key={child.value} asChild>
                    <SelectItem
                      value={child.value}
                      disabled={value?.eventDataList?.some(item => item.name === child.value)}
                      className='flex justify-between'
                    >
                      <span>{child.label}</span>
                      <span className='text-xs text-gray-500'>{child.description}</span>
                    </SelectItem>
                  </DialogTrigger>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ))}
      </div>
      <Table className='mt-4'>
        <TableHeader>
          <TableRow>
            <TableHead className='w-[220px] text-xs'>已有事件</TableHead>
            <TableHead className='text-xs'>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {value?.eventDataList?.map(eventData => (
            <TableRow key={eventData.name}>
              <TableCell className='font-medium text-xs'>
                {eventData.name}
                <span className='px-2'>-</span>
                <Button variant='link' className='text-xs px-0 py-0 h-0'>
                  {eventData.relatedEventName}
                </Button>
              </TableCell>
              <TableCell className='flex gap-2'>
                <Settings className='h-3 w-3 cursor-pointer' onClick={() => handleEditEvent(eventData)} />
                <AlertModal
                  title='确定删除吗？'
                  description='删除后，该状态将无法恢复。'
                  trigger={<Trash className='h-3 w-3 cursor-pointer' />}
                  onConfirm={() => handleDeleteEvent(eventData)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </EventBindModal>
  )
}

export default EventSetter
