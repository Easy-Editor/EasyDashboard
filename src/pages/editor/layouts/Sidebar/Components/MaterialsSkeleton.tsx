import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Skeleton } from '@/components/ui/skeleton'

export const MaterialsSkeleton = () => {
  return (
    <Accordion type='single' collapsible defaultValue='loading-skeleton'>
      <AccordionItem value='loading-skeleton'>
        <AccordionTrigger className='py-2.5 px-3 text-sm font-medium'>
          <Skeleton className='h-4 w-24' />
        </AccordionTrigger>
        <AccordionContent className='pt-2 pb-3 px-2'>
          <div className='grid grid-cols-2 gap-2 p-2'>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className='aspect-square rounded-lg' />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
