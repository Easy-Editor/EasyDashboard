import type { Ref } from 'react'
import {
  Carousel as UCarousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import { Card, CardContent } from '@/components/ui/card'

interface CarouselProps {
  ref: Ref<HTMLDivElement>
}

const Carousel = (props: CarouselProps) => {
  const { ref, ...rest } = props

  return (
    <UCarousel ref={ref} className='w-full h-full' {...rest}>
      <CarouselContent>
        {Array.from({ length: 5 }).map((_, index) => (
          <CarouselItem key={index}>
            <div className='p-1'>
              <Card>
                <CardContent className='flex aspect-square items-center justify-center p-6'>
                  <span className='text-4xl font-semibold'>{index + 1}</span>
                </CardContent>
              </Card>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </UCarousel>
  )
}

export default Carousel
