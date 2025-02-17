import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { Ref } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList } from 'recharts'

const chartData = [
  { month: 'January', visitors: 186 },
  { month: 'February', visitors: 205 },
  { month: 'March', visitors: -207 },
  { month: 'April', visitors: 173 },
  { month: 'May', visitors: -209 },
  { month: 'June', visitors: 214 },
]

const chartConfig = {
  visitors: {
    label: 'Visitors',
  },
} satisfies ChartConfig

interface MBarChartProps {
  ref: Ref<HTMLDivElement>
}

const MBarChart = (props: MBarChartProps) => {
  const { ref } = props

  return (
    <ChartContainer ref={ref} config={chartConfig} className='w-full h-full'>
      <BarChart accessibilityLayer data={chartData}>
        <CartesianGrid vertical={false} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel hideIndicator />} />
        <Bar dataKey='visitors'>
          <LabelList position='top' dataKey='month' fillOpacity={1} />
          {chartData.map(item => (
            <Cell key={item.month} fill={item.visitors > 0 ? 'var(--chart-1)' : 'var(--chart-2)'} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

export default MBarChart
