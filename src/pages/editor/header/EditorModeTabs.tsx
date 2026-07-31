import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type EditorMode, useEditorMode } from '@/contexts/editor-mode-context'
import { Code, LayoutDashboard } from 'lucide-react'

const modes: { value: EditorMode; label: string; icon: React.ElementType }[] = [
  { value: 'canvas', label: '画布', icon: LayoutDashboard },
  { value: 'code', label: '代码', icon: Code },
]

export function EditorModeTabs() {
  const { mode, setMode } = useEditorMode()

  return (
    <Tabs value={mode} onValueChange={value => setMode(value as EditorMode)}>
      <TabsList className='h-7 rounded-md border border-[var(--ed-line)] bg-[var(--ed-canvas)] p-0.5'>
        {modes.map(({ value, label, icon: Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            className='h-6 gap-1.5 rounded-[4px] px-2.5 text-[11px] text-[var(--ed-ink-faint)] data-[state=active]:bg-[var(--ed-panel-raised)] data-[state=active]:text-[var(--ed-ink)]'
          >
            <Icon className='size-3' />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
