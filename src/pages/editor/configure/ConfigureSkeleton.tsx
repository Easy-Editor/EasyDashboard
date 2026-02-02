import { Skeleton } from '@/components/ui/skeleton'

export const ConfigureSkeleton = () => {
  return (
    <div className='space-y-4'>
      <div className='flex gap-2'>
        <Skeleton className='h-8 w-1/3' />
        <Skeleton className='h-8 w-1/3' />
        <Skeleton className='h-8 w-1/3' />
      </div>
      <Skeleton className='h-32 w-full' />
      <Skeleton className='h-32 w-full' />
    </div>
  )
}
