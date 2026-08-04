import { CodeEditor } from '@/components/common/code-editor'
import { Button } from '@/components/ui/button'
import { useEditorMode } from '@/contexts/editor-mode-context'
import { useDebounceFn } from '@/hooks/useDebounceFn'
import { project } from '@easy-editor/core'
import { Code, X } from 'lucide-react'
import { observer } from 'mobx-react'
import { useEffect, useState } from 'react'

export const CodeView = observer(() => {
  const schema = project.export()
  const [code, setCode] = useState(() => JSON.stringify(schema, null, 2))
  const [hasError, setHasError] = useState(false)
  const { setMode } = useEditorMode()

  // 当 schema 变化时更新代码（从画布同步到代码）
  useEffect(() => {
    const newCode = JSON.stringify(schema, null, 2)
    setCode(newCode)
    setHasError(false)
  }, [schema])

  // 防抖同步到画布
  const { run: syncToCanvas } = useDebounceFn(
    (value: string) => {
      try {
        const parsed = JSON.parse(value)
        project.load(parsed, true)
        setHasError(false)
      } catch (e) {
        setHasError(true)
        console.warn('Invalid JSON:', e)
      }
    },
    { wait: 800 },
  )

  const handleChange = (value: string | undefined) => {
    if (value === undefined) return
    setCode(value)

    // 验证 JSON 格式
    try {
      JSON.parse(value)
      setHasError(false)
      syncToCanvas(value)
    } catch {
      setHasError(true)
    }
  }

  const handleClose = () => {
    setMode('canvas')
  }

  return (
    <div className='flex flex-col h-full w-full bg-background/95 backdrop-blur-sm'>
      {/* 标题栏 */}
      <div className='flex items-center justify-between px-4 py-3 border-b border-border/60 bg-background'>
        <div className='flex items-center gap-2'>
          <Code className='h-4 w-4 text-muted-foreground' />
          <span className='text-sm font-medium'>页面结构代码</span>
          {hasError && (
            <span className='text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded'>JSON 格式错误</span>
          )}
        </div>
        <Button variant='ghost' size='icon' className='h-7 w-7' onClick={handleClose}>
          <X className='h-4 w-4' />
        </Button>
      </div>
      {/* 代码编辑器 */}
      <div className='flex-1 min-h-0 p-4'>
        <div className='h-full rounded-lg border border-border/60 overflow-hidden'>
          <CodeEditor
            language='json'
            value={code}
            onChange={handleChange}
            options={{
              readOnly: false,
              wordWrap: 'on',
              padding: { top: 16, bottom: 16 },
            }}
          />
        </div>
      </div>
    </div>
  )
})
