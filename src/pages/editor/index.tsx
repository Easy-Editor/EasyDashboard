import AppLayout from './EditorLayout'
import { Suspense } from 'react'
import Renderer from './canvas/Renderer'

export default function Editor() {
  return (
    <Suspense fallback={<div className='w-full h-screen flex items-center justify-center'>初始化编辑器中...</div>}>
      <AppLayout>
        <Renderer />
      </AppLayout>
    </Suspense>
  )
}
