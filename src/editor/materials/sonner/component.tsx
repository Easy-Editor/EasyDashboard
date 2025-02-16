import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Ref } from 'react'

interface SonnerProps {
  ref: Ref<HTMLButtonElement>
}

const Sonner = (props: SonnerProps) => {
  const { ref } = props

  return (
    <Button
      ref={ref}
      className='w-full h-full'
      variant='outline'
      onClick={() =>
        toast('Event has been created', {
          description: 'Sunday, December 03, 2023 at 9:00 AM',
          action: {
            label: 'Undo',
            onClick: () => console.log('Undo'),
          },
        })
      }
    >
      Show Toast
    </Button>
  )
}

export default Sonner
