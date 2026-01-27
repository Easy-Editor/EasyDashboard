import { type PropsWithChildren, type Ref, forwardRef } from 'react'

interface GroupProps extends PropsWithChildren {
  style?: React.CSSProperties
}

const Group = forwardRef((props: GroupProps, ref: Ref<HTMLDivElement>) => {
  const { style, children } = props

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        ...style,
      }}
    >
      {children}
    </div>
  )
})

export default Group
