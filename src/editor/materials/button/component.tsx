import { type Ref, forwardRef } from 'react'

interface ButtonProps {
  type?: 'primary' | 'default'
  text?: string
  onClick?: () => void
}

const Button = forwardRef((props: ButtonProps, ref: Ref<HTMLButtonElement>) => {
  return (
    <button ref={ref} type='button' className='w-full h-full' onClick={props.onClick}>
      {props?.text}
    </button>
  )
})

export default Button
