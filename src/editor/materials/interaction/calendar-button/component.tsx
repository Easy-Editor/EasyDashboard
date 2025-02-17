import { useState, type Ref } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CalendarIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface CalendarProps {
  ref: Ref<HTMLDivElement>
}

const CalendarButton = (props: CalendarProps) => {
  const { ref, ...rest } = props
  const [date, setDate] = useState<Date>()

  return (
    <div ref={ref} className='w-full h-full'>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={'outline'}
            className={cn('w-full h-full justify-start text-left font-normal', !date && 'text-muted-foreground')}
          >
            <CalendarIcon className='mr-2 h-4 w-4' />
            {<span>Pick a date</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-auto p-0'>
          <Calendar mode='single' selected={date} onSelect={setDate} initialFocus {...rest} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default CalendarButton
