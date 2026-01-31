import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { project } from '@easy-editor/core'
import { Monitor, Smartphone, Tablet, TvMinimal } from 'lucide-react'
import { observer } from 'mobx-react'
import { useCallback, useEffect, useState } from 'react'

// 常用分辨率预设
const RESOLUTION_PRESETS = [
  { label: 'HD', tooltip: '1280 x 720', value: '1280x720', width: 1280, height: 720, icon: Smartphone },
  { label: 'FHD', tooltip: '1920 x 1080', value: '1920x1080', width: 1920, height: 1080, icon: Monitor },
  { label: '2K', tooltip: '2560 x 1440', value: '2560x1440', width: 2560, height: 1440, icon: Tablet },
  { label: '4K', tooltip: '3840 x 2160', value: '3840x2160', width: 3840, height: 2160, icon: TvMinimal },
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

  // 输入框失焦时应用自定义分辨率
  const handleInputBlur = () => {
    if (customWidth !== currentWidth || customHeight !== currentHeight) {
      updateResolution(customWidth, customHeight)
    }
  }

  // 回车键应用
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (customWidth !== currentWidth || customHeight !== currentHeight) {
        updateResolution(customWidth, customHeight)
      }
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      {/* 预设快捷选择 */}
      <TooltipProvider delayDuration={100}>
        <ToggleGroup
          type='single'
          value={selectedPreset}
          onValueChange={handlePresetChange}
          className='grid grid-cols-4 gap-1 w-full'
        >
          {RESOLUTION_PRESETS.map(preset => {
            const Icon = preset.icon
            return (
              <Tooltip key={preset.value}>
                <TooltipTrigger asChild>
                  <ToggleGroupItem
                    value={preset.value}
                    className={cn(
                      'flex flex-col items-center justify-center gap-0.5 h-12 rounded-md border border-transparent',
                      'hover:bg-accent/50 hover:border-accent',
                      'data-[state=on]:bg-accent data-[state=on]:border-primary/50',
                      'transition-all duration-150',
                    )}
                  >
                    <Icon className='size-4 opacity-70' />
                    <span className='text-[10px] font-medium'>{preset.label}</span>
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent side='bottom' className='text-xs'>
                  {preset.tooltip}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </ToggleGroup>
      </TooltipProvider>

      {/* 自定义输入 */}
      <div className='flex items-center gap-2'>
        <div className='relative flex-1'>
          <Input
            type='number'
            min={1}
            value={customWidth}
            onChange={handleWidthChange}
            onBlur={handleInputBlur}
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
            onBlur={handleInputBlur}
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
