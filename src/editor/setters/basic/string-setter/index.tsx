import { Input } from '@/components/ui/input'
import type { SetterProps } from '@easy-editor/core'

interface StringSetterProps extends SetterProps<string> {
  placeholder: string
}

const StringSetter = (props: StringSetterProps) => {
  const { value, placeholder, onChange } = props

  return <Input value={value} placeholder={placeholder || ''} onChange={e => onChange(e.target.value)} />
}

export default StringSetter
