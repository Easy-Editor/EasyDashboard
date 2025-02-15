import type { Ref } from 'react'

interface RootProps {
  ref: Ref<HTMLDivElement>
  backgroundColor?: string
  children?: React.ReactNode
}

const Root = (props: RootProps) => {
  const { ref, backgroundColor, children } = props

  return (
    <div ref={ref} className='w-full h-full' style={{ backgroundColor }}>
      {children}
    </div>
  )
}

export default Root
