import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { Ref } from 'react'
import { Pie, PieChart } from 'recharts'

const desktopData = [
  { month: 'january', desktop: 186, fill: 'var(--color-january)' },
  { month: 'february', desktop: 305, fill: 'var(--color-february)' },
  { month: 'march', desktop: 237, fill: 'var(--color-march)' },
  { month: 'april', desktop: 173, fill: 'var(--color-april)' },
  { month: 'may', desktop: 209, fill: 'var(--color-may)' },
]

const mobileData = [
  { month: 'january', mobile: 80, fill: 'var(--color-january)' },
  { month: 'february', mobile: 200, fill: 'var(--color-february)' },
  { month: 'march', mobile: 120, fill: 'var(--color-march)' },
  { month: 'april', mobile: 190, fill: 'var(--color-april)' },
  { month: 'may', mobile: 130, fill: 'var(--color-may)' },
]

const chartConfig = {
  visitors: {
    label: 'Visitors',
  },
  desktop: {
    label: 'Desktop',
  },
  mobile: {
    label: 'Mobile',
  },
  january: {
    label: 'January',
    color: 'var(--chart-1)',
  },
  february: {
    label: 'February',
    color: 'var(--chart-2)',
  },
  march: {
    label: 'March',
    color: 'var(--chart-3)',
  },
  april: {
    label: 'April',
    color: 'var(--chart-4)',
  },
  may: {
    label: 'May',
    color: 'var(--chart-5)',
  },
} satisfies ChartConfig

interface MPieChartProps {
  ref: Ref<HTMLDivElement>
}

const MPieChart = (props: MPieChartProps) => {
  const { ref } = props

  return (
    <ChartContainer ref={ref} config={chartConfig} className='w-full h-full mx-auto aspect-square'>
      <PieChart>
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey='visitors'
              nameKey='month'
              indicator='line'
              labelFormatter={(_, payload) => {
                return chartConfig[payload?.[0].dataKey as keyof typeof chartConfig].label
              }}
            />
          }
        />
        <Pie data={desktopData} dataKey='desktop' outerRadius={60} />
        <Pie data={mobileData} dataKey='mobile' innerRadius={70} outerRadius={90} />
      </PieChart>
    </ChartContainer>
  )
}

export default MPieChart
