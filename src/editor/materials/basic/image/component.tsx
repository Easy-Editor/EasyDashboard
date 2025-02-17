import Banner from '@/assets/banner.png'
import type { Ref } from 'react'

interface ImageProps {
  ref: Ref<HTMLDivElement>
}

const Image = (props: ImageProps) => {
  const { ref } = props

  return (
    <div ref={ref} className='w-full h-full'>
      <img className='w-full h-full' src={Banner} alt='img' onDragStart={e => e.preventDefault()} />
    </div>
  )
}

export default Image
