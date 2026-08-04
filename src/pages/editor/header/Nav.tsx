import { Button } from '@/components/ui/button'
import { project } from '@easy-editor/core'
import { ArrowLeft } from 'lucide-react'
import { observer } from 'mobx-react'
import { Link } from 'react-router'

export const MainNav = observer(function MainNav({
  projectName,
  saveStatus,
}: {
  projectName: string
  saveStatus: string
}) {
  const currentDocument = project.currentDocument
  const currentPageName =
    currentDocument?.rootNode?.getExtraProp('fileDesc', false)?.getAsString() ||
    currentDocument?.fileName ||
    '未打开页面'

  return (
    <div className='flex min-w-0 items-center gap-2'>
      <Button
        asChild
        variant='ghost'
        size='sm'
        className='size-7 shrink-0 p-0 text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
      >
        <Link to='/projects' aria-label='返回我的项目'>
          <ArrowLeft className='size-4' />
        </Link>
      </Button>
      <div className='h-5 w-px shrink-0 bg-[var(--ed-line)]' />
      <div className='hidden min-w-0 sm:block'>
        <p className='flex max-w-28 min-w-0 items-center gap-1.5 text-[11px] font-medium sm:max-w-48 lg:max-w-64'>
          <span className='truncate text-[var(--ed-ink)]'>{projectName}</span>
          <span aria-hidden='true' className='shrink-0 text-[var(--ed-ink-faint)]'>
            /
          </span>
          <span className='truncate text-[var(--ed-ink-muted)]'>{currentPageName}</span>
        </p>
        <p className='mt-0.5 hidden text-[10px] leading-none text-[var(--ed-ink-faint)] sm:block'>{saveStatus}</p>
      </div>
    </div>
  )
})
