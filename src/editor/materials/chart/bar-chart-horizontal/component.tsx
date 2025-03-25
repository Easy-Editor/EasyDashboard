import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { Ref } from 'react'
import { Bar, BarChart, XAxis, YAxis } from 'recharts'

const chartData = [
  { month: 'January', desktop: 186 },
  { month: 'February', desktop: 305 },
  { month: 'March', desktop: 237 },
  { month: 'April', desktop: 73 },
  { month: 'May', desktop: 209 },
  { month: 'June', desktop: 214 },
]

const chartConfig = {
  desktop: {
    label: 'Desktop',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig

interface MBarChartProps {
  ref: Ref<HTMLDivElement>
}

const MBarChart = (props: MBarChartProps) => {
  const { ref } = props

  return (
    <ChartContainer ref={ref} config={chartConfig} className='w-full h-full'>
      <BarChart
        accessibilityLayer
        data={chartData}
        layout='vertical'
        margin={{
          left: -20,
        }}
      >
        <XAxis type='number' dataKey='desktop' hide />
        <YAxis
          dataKey='month'
          type='category'
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tickFormatter={value => value.slice(0, 3)}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey='desktop' fill='var(--chart-1)' radius={5} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

export default MBarChart
