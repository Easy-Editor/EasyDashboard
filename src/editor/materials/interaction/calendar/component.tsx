import type { Ref } from 'react'
import { Calendar as UCalendar } from '@/components/ui/calendar'

interface CalendarProps {
  ref: Ref<HTMLDivElement>
}

const Calendar = (props: CalendarProps) => {
  const { ref, ...rest } = props

  return (
    <div ref={ref} className='w-full h-full'>
      <UCalendar mode='single' className='rounded-md border' {...rest} />
    </div>
  )
}

export default Calendar
