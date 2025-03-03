import { DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { JSFunction, SetterProps } from '@easy-editor/core'
import { useState } from 'react'
import EventBindModal, { type EventBindModalProps, type Tab } from './event-bind-modal'

interface EventData {
  type: Tab
  name: string
  relatedEventName: string
  paramStr?: string
}

export interface Event {
  eventDataList?: EventData[]
  eventList?: EventData[]
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

    onChange?.({
      ...value,
      eventDataList: [...(value?.eventDataList || []), newEventData],
    })
  }

  console.log('value', value)

  return (
    <EventBindModal open={open} onClose={() => setOpen(false)} methods={methods} onConfirm={handleModalConfirm}>
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
                    <SelectItem value={child.value}>{child.label}</SelectItem>
                  </DialogTrigger>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ))}
      </div>
    </EventBindModal>
  )
}

export default EventSetter
