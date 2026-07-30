import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'

export function MainNav({
  projectName,
  saveStatus,
}: {
  projectName: string
  saveStatus: string
}) {
  return (
    <div className='flex min-w-0 items-center gap-2'>
      <Button
        asChild
        variant='ghost'
        size='sm'
        className='h-7 shrink-0 gap-1.5 px-1.5 text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
      >
        <Link to='/projects' aria-label='返回我的项目'>
          <ArrowLeft className='size-4' />
          <span className='hidden lg:inline'>我的项目</span>
        </Link>
      </Button>
      <div className='h-5 w-px shrink-0 bg-[var(--ed-line)]' />
      <div className='hidden min-w-0 sm:block'>
        <p className='max-w-28 truncate text-[11px] font-medium text-[var(--ed-ink)] sm:max-w-40 lg:max-w-56'>
          {projectName}
        </p>
        <p className='mt-0.5 hidden text-[10px] leading-none text-[var(--ed-ink-faint)] sm:block'>{saveStatus}</p>
      </div>
    </div>
  )
}
