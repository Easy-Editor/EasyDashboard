import { type ReactNode, createContext, useContext, useState } from 'react'

export type EditorMode = 'canvas' | 'code'

interface EditorModeContextValue {
  mode: EditorMode
  setMode: (mode: EditorMode) => void
}

const EditorModeContext = createContext<EditorModeContextValue | null>(null)

export function EditorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<EditorMode>('canvas')

  return <EditorModeContext.Provider value={{ mode, setMode }}>{children}</EditorModeContext.Provider>
}

export function useEditorMode() {
  const context = useContext(EditorModeContext)
  if (!context) {
    throw new Error('useEditorMode must be used within an EditorModeProvider')
  }
  return context
}
