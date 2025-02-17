import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { Ref } from 'react'
import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from 'recharts'

const chartData = [
  { month: 'January', desktop: 186, mobile: 160 },
  { month: 'February', desktop: 185, mobile: 170 },
  { month: 'March', desktop: 207, mobile: 180 },
  { month: 'April', desktop: 173, mobile: 160 },
  { month: 'May', desktop: 160, mobile: 190 },
  { month: 'June', desktop: 174, mobile: 204 },
]

const chartConfig = {
  desktop: {
    label: 'Desktop',
    color: 'var(--chart-1)',
  },
  mobile: {
    label: 'Mobile',
    color: 'var(--chart-2)',
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
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator='line' />} />
        <PolarAngleAxis dataKey='month' />
        <PolarGrid radialLines={false} />
        <Radar dataKey='desktop' fill='var(--chart-1)' fillOpacity={0} stroke='var(--chart-1)' strokeWidth={2} />
        <Radar dataKey='mobile' fill='var(--chart-2)' fillOpacity={0} stroke='var(--chart-2)' strokeWidth={2} />
      </RadarChart>
    </ChartContainer>
  )
}

export default MRadarChart
