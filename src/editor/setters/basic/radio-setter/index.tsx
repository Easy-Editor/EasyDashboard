import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { SetterProps } from '@easy-editor/core'

interface RadioSetterProps extends SetterProps<string> {
  options: { label: string; value: string }[]
  orientation?: 'horizontal' | 'vertical'
}

const RadioSetter = (props: RadioSetterProps) => {
  const { value, onChange, options, orientation = 'horizontal' } = props

  return (
    <RadioGroup defaultValue={value} className='w-full' onValueChange={onChange} orientation={orientation}>
      {options.map(item => (
        <div key={item.value} className='flex items-center space-x-2'>
          <RadioGroupItem value={item.value} id={item.value} />
          <Label className='text-xs' htmlFor={item.value}>
            {item.label}
          </Label>
        </div>
      ))}
    </RadioGroup>
  )
}

export default RadioSetter
