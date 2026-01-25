import type { Project } from '@easy-editor/core'

export const createHistoryHandlers = (project: Project) => ({
  undo: () => {
    const history = project.currentDocument?.history
    if (history?.isUndoable()) {
      history.back()
    }
  },

  redo: () => {
    const history = project.currentDocument?.history
    if (history?.isRedoable()) {
      history.forward()
    }
  },
})
