import { requestEditorSave } from '@/editor/persistence/editor-events'

export const createProjectHandlers = () => ({
  save: () => {
    requestEditorSave()
  },
})
