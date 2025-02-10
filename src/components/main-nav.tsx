import { Icons } from '@/components/icons'

export function MainNav() {
  return (
    <div className='mr-4 hidden md:flex'>
      <div className='mr-4 flex items-center gap-2 lg:mr-6'>
        <Icons.logo className='w-8 h-8' />
        <span className='hidden font-bold lg:inline-block'>Easy Dashboard</span>
      </div>
      <nav className='flex items-center gap-4 text-sm xl:gap-6'></nav>
    </div>
  )
}
