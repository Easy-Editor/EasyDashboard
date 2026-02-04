import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type EditorMode, useEditorMode } from '@/contexts/editor-mode-context'
import { Code, Eye, LayoutDashboard } from 'lucide-react'

const modes: { value: EditorMode; label: string; icon: React.ElementType }[] = [
  { value: 'canvas', label: '画布', icon: LayoutDashboard },
  { value: 'preview', label: '预览', icon: Eye },
  { value: 'code', label: '代码', icon: Code },
]

export function EditorModeTabs() {
  const { mode, setMode } = useEditorMode()

  return (
    <Tabs value={mode} onValueChange={value => setMode(value as EditorMode)}>
      <TabsList className='h-8 bg-muted/50'>
        {modes.map(({ value, label, icon: Icon }) => (
          <TabsTrigger key={value} value={value} className='h-7 gap-1.5 px-3 text-xs'>
            <Icon className='h-3.5 w-3.5' />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
