import type { Ref } from 'react'
import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from 'recharts'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'

const chartData = [
  { month: 'January', desktop: 186 },
  { month: 'February', desktop: 305 },
  { month: 'March', desktop: 237 },
  { month: 'April', desktop: 273 },
  { month: 'May', desktop: 209 },
  { month: 'June', desktop: 214 },
]

const chartConfig = {
  desktop: {
    label: 'Desktop',
    color: 'hsl(var(--chart-1))',
  },
} satisfies ChartConfig

interface MRadarChartProps {
  ref: Ref<HTMLDivElement>
}

const MRadarChart = (props: MRadarChartProps) => {
  const { ref } = props

  return (
    <ChartContainer ref={ref} config={chartConfig} className='w-full h-full mx-auto aspect-square'>
      <RadarChart data={chartData}>
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <PolarAngleAxis dataKey='month' />
        <PolarGrid />
        <Radar dataKey='desktop' fill='var(--chart-1)' fillOpacity={0.6} />
      </RadarChart>
    </ChartContainer>
  )
}

export default MRadarChart
