import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { type Snippet as ISnippet, project } from '@easy-editor/core'
import React, { useEffect } from 'react'
import './const'
import { snippets } from './const'

const Snippet = ({ snippet }: { snippet: ISnippet }) => {
  const ref = React.useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unlink = project.simulator?.linkSnippet(ref.current!, snippet)
    return () => {
      unlink?.()
    }
  }, [snippet])

  return (
    <Card ref={ref} className='cursor-move select-none hover:scale-105 transition-all duration-300'>
      <CardContent
        className={cn(
          snippet.screenshot ? 'justify-between' : 'justify-center',
          'flex flex-col justify-center items-center w-full h-[80px] p-4',
        )}
      >
        {snippet.screenshot && <img src={snippet.screenshot} alt={snippet.title} className='object-cover' />}
        {snippet.title && (
          <span className='w-full text-sm font-medium text-center overflow-hidden text-ellipsis whitespace-nowrap'>
            {snippet.title}
          </span>
        )}
      </CardContent>
    </Card>
  )
}

export const MaterialsSidebar = () => {
  return (
    <div className='flex flex-col overflow-y-auto px-4'>
      <Accordion type='single' collapsible>
        {snippets.map(({ title, snippets }) => (
          <AccordionItem key={title} value={title}>
            <AccordionTrigger>{title}</AccordionTrigger>
            <AccordionContent className='transition-all data-[state=closed]:animate-[accordion-up_300ms_ease-out] data-[state=open]:animate-[accordion-down_400ms_ease-out]'>
              <div className='grid grid-cols-2 gap-2 p-2'>
                {snippets?.map(snippet => (
                  <Snippet key={snippet.title} snippet={snippet} />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
