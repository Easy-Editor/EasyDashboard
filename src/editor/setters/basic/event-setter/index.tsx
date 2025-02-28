import EventBindModal from '@/components/event/event-bind-modal'
import { DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SetterProps } from '@easy-editor/core'
import { useState } from 'react'

interface EventSetterProps extends SetterProps<string> {
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
  const { events } = props
  // 这里需要使用 key 来触发重新渲染，让 select 保持 undefined
  const [openKey, setOpenKey] = useState(0)
  const [open, setOpen] = useState(false)

  const handleValueChange = (value: string) => {
    setOpenKey(prev => prev + 1)
    setOpen(true)
  }

  return (
    <EventBindModal open={open} onClose={() => setOpen(false)}>
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
