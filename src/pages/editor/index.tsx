import { EditorSessionProvider } from '@/contexts/editor-session-context'
import { Suspense } from 'react'
import { useParams } from 'react-router'
import AppLayout from './EditorLayout'
import Renderer from './canvas/Renderer'

export default function Editor() {
  const { projectId } = useParams<{ projectId: string }>()

  if (!projectId) {
    return <div className='grid h-screen place-items-center bg-[#080A0D] text-sm text-[#8D99A3]'>项目地址无效</div>
  }

  return (
    <EditorSessionProvider key={projectId} projectId={projectId}>
      <Suspense fallback={<div className='w-full h-screen flex items-center justify-center'>初始化编辑器中...</div>}>
        <AppLayout>
          <Renderer />
        </AppLayout>
      </Suspense>
    </EditorSessionProvider>
  )
}
