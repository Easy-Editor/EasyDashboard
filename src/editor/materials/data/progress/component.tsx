import { Progress as UProgress } from '@/components/ui/progress'
import type { Ref } from 'react'

interface ProgressProps {
  ref: Ref<HTMLDivElement>
}

const Progress = (props: ProgressProps) => {
  const { ref } = props

  return <UProgress ref={ref} value={33} />
}

export default Progress
