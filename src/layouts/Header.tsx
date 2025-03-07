import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MainNav } from './Nav'

export function AppHeader({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        'w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className,
      )}
    >
      <div className='border-border/70 dark:border-border w-full border-dashed'>
        <div className='flex h-14 items-center px-4'>
          <MainNav />
          <div className='flex flex-1 items-center justify-between gap-2 md:justify-end'>
            <div className='w-full flex-1 md:w-auto md:flex-none' />
            <div className='flex items-center gap-2'>
              <Button variant='outline'>预览</Button>
              <Button variant='outline'>保存</Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
