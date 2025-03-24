import AppLayout from '@/pages/editor/layouts'
import { Suspense } from 'react'
import Renderer from './Renderer'

export default function Editor() {
  return (
    <Suspense fallback={<div className='w-full h-screen flex items-center justify-center'>初始化编辑器中...</div>}>
      <AppLayout>
        <Renderer />
      </AppLayout>
    </Suspense>
  )
}
