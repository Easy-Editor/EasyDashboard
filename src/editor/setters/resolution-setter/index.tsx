import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { project } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { useCallback, useEffect, useState } from 'react'

// 常用分辨率预设
const RESOLUTION_PRESETS = [
  { label: 'HD', value: '1280x720', width: 1280, height: 720 },
  { label: 'FHD', value: '1920x1080', width: 1920, height: 1080 },
  { label: '2K', value: '2560x1440', width: 2560, height: 1440 },
  { label: '4K', value: '3840x2160', width: 3840, height: 2160 },
] as const

interface ResolutionValue {
  width: number
  height: number
}

interface ResolutionSetterProps {
  value?: ResolutionValue
  onChange?: (value: ResolutionValue) => void
}

const ResolutionSetter = observer((props: ResolutionSetterProps) => {
  const { value, onChange } = props

  const currentWidth = value?.width ?? 1920
  const currentHeight = value?.height ?? 1080

  // 判断当前值是否匹配预设
  const getCurrentPreset = useCallback(() => {
    const preset = RESOLUTION_PRESETS.find(p => p.width === currentWidth && p.height === currentHeight)
    return preset?.value ?? ''
  }, [currentWidth, currentHeight])

  const [selectedPreset, setSelectedPreset] = useState(getCurrentPreset())
  const [customWidth, setCustomWidth] = useState(currentWidth)
  const [customHeight, setCustomHeight] = useState(currentHeight)

  // 同步外部值变化
  useEffect(() => {
    setSelectedPreset(getCurrentPreset())
    setCustomWidth(currentWidth)
    setCustomHeight(currentHeight)
  }, [currentWidth, currentHeight, getCurrentPreset])

  // 更新分辨率（同时更新 simulator viewport）
  const updateResolution = useCallback(
    (width: number, height: number) => {
      onChange?.({ width, height })

      const simulator = project.simulator
      if (simulator) {
        simulator.set('deviceStyle', { viewport: { width, height } })
      }
    },
    [onChange],
  )

  // 预设选择变化
  const handlePresetChange = (presetValue: string) => {
    if (!presetValue) return
    setSelectedPreset(presetValue)

    const preset = RESOLUTION_PRESETS.find(p => p.value === presetValue)
    if (preset) {
      setCustomWidth(preset.width)
      setCustomHeight(preset.height)
      updateResolution(preset.width, preset.height)
    }
  }

  // 自定义宽度变化
  const handleWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const width = Math.max(1, Number.parseInt(e.target.value) || 1)
    setCustomWidth(width)
    setSelectedPreset('')
  }

  // 自定义高度变化
  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const height = Math.max(1, Number.parseInt(e.target.value) || 1)
    setCustomHeight(height)
    setSelectedPreset('')
  }

  const applyCustomResolution = () => {
    if (customWidth !== currentWidth || customHeight !== currentHeight) {
      updateResolution(customWidth, customHeight)
    }
  }

  // 在宽高输入之间切换时不提交，只在离开整组输入后应用一次
  const handleInputGroupBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    applyCustomResolution()
  }

  // 回车键应用
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      applyCustomResolution()
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      {/* 预设快捷选择 */}
      <ToggleGroup
        type='single'
        value={selectedPreset}
        onValueChange={handlePresetChange}
        className='grid w-full grid-cols-4 gap-1'
      >
        {RESOLUTION_PRESETS.map(preset => (
          <ToggleGroupItem
            key={preset.value}
            value={preset.value}
            aria-label={`${preset.label} ${preset.width} × ${preset.height}`}
            className={cn(
              'flex h-12 flex-col items-center justify-center gap-1 rounded-md border border-transparent',
              'hover:border-accent hover:bg-accent/50',
              'data-[state=on]:border-primary/50 data-[state=on]:bg-accent',
              'transition-all duration-150',
            )}
          >
            <span className='text-[10px] font-medium'>{preset.label}</span>
            <span className='font-mono text-[8px] tabular-nums text-muted-foreground'>
              {preset.width}×{preset.height}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* 自定义输入 */}
      <div className='flex items-center gap-2' onBlur={handleInputGroupBlur}>
        <div className='relative flex-1'>
          <Input
            type='number'
            min={1}
            value={customWidth}
            onChange={handleWidthChange}
            onKeyDown={handleKeyDown}
            className='h-8 pr-7 text-xs font-mono tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
          />
          <span className='absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none'>
            W
          </span>
        </div>
        <span className='text-muted-foreground/50 text-xs select-none'>×</span>
        <div className='relative flex-1'>
          <Input
            type='number'
            min={1}
            value={customHeight}
            onChange={handleHeightChange}
            onKeyDown={handleKeyDown}
            className='h-8 pr-7 text-xs font-mono tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
          />
          <span className='absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none'>
            H
          </span>
        </div>
      </div>
    </div>
  )
})

export default ResolutionSetter
