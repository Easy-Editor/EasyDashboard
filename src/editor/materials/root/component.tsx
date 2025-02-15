import { type Ref, forwardRef } from 'react'

interface RootProps {
  backgroundColor?: string
  children?: React.ReactNode
}

const Root = forwardRef((props: RootProps, ref: Ref<HTMLDivElement>) => {
  return (
    <div ref={ref} className='w-full h-full' style={{ backgroundColor: props?.backgroundColor }}>
      {props?.children}
    </div>
  )
})

export default Root
