import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { Ref } from 'react'
import { Label, PolarRadiusAxis, RadialBar, RadialBarChart } from 'recharts'

const chartData = [{ month: 'january', desktop: 1260, mobile: 570 }]
const totalVisitors = chartData[0].desktop + chartData[0].mobile

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

interface MRadialChartProps {
  ref: Ref<HTMLDivElement>
}

const MRadialChart = (props: MRadialChartProps) => {
  const { ref } = props

  return (
    <ChartContainer ref={ref} config={chartConfig} className='w-full h-full mx-auto aspect-square'>
      <RadialBarChart data={chartData} endAngle={180} innerRadius={80} outerRadius={130}>
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
          <Label
            content={({ viewBox }) => {
              if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor='middle'>
                    <tspan x={viewBox.cx} y={(viewBox.cy || 0) - 16} className='fill-foreground text-2xl font-bold'>
                      {totalVisitors.toLocaleString()}
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 4} className='fill-muted-foreground'>
                      Visitors
                    </tspan>
                  </text>
                )
              }
            }}
          />
        </PolarRadiusAxis>
        <RadialBar
          dataKey='desktop'
          stackId='a'
          cornerRadius={5}
          fill='var(--color-desktop)'
          className='stroke-transparent stroke-2'
          isAnimationActive={false}
        />
        <RadialBar
          dataKey='mobile'
          fill='var(--color-mobile)'
          stackId='a'
          cornerRadius={5}
          className='stroke-transparent stroke-2'
          isAnimationActive={false}
        />
      </RadialBarChart>
    </ChartContainer>
  )
}

export default MRadialChart
