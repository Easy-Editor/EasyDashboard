import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useEffect, useId, useState } from 'react'

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function ColorTokenField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const isValid = HEX_COLOR_PATTERN.test(draft)

  useEffect(() => setDraft(value), [value])

  const commitDraft = () => {
    if (isValid && draft !== value) onChange(draft.toUpperCase())
    if (!isValid) setDraft(value)
  }

  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id} className='text-[11px] font-normal text-[#8D99A3]'>
        {label}
      </Label>
      <div className='flex items-center gap-2'>
        <label
          className='relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-[#34414C] bg-[#141A20] focus-within:ring-2 focus-within:ring-[#49CFF0]/40'
          aria-label={`${label}颜色选择器`}
        >
          <input
            type='color'
            value={HEX_COLOR_PATTERN.test(value) ? value : '#000000'}
            onChange={event => onChange(event.target.value.toUpperCase())}
            className='absolute -inset-2 size-14 cursor-pointer border-0 bg-transparent p-0'
          />
        </label>
        <Input
          id={id}
          value={draft}
          aria-invalid={!isValid}
          spellCheck={false}
          maxLength={7}
          onChange={event => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setDraft(value)
              event.currentTarget.blur()
            }
          }}
          className='h-9 rounded-md border-[#34414C] bg-[#141A20] px-2 font-mono text-xs uppercase text-[#DCE5EA]'
        />
      </div>
      {isValid ? null : <p className='text-[10px] text-[#F28B82]'>请输入 6 位十六进制颜色，例如 #49CFF0</p>}
    </div>
  )
}
