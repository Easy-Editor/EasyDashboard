import type { Project } from '@easy-editor/core'
import { MOVE_STEP } from '../const'

type Direction = 'up' | 'down' | 'left' | 'right'

export const createMovementHandlers = (project: Project) => {
  const moveNodes = (direction: Direction, step: number) => {
    const selectedNodes = project.designer.selection.getTopNodes(false)
    if (!selectedNodes?.length) return

    for (const node of selectedNodes) {
      const rect = node.getDashboardRect()
      let { x, y } = rect

      switch (direction) {
        case 'up':
          y -= step
          break
        case 'down':
          y += step
          break
        case 'left':
          x -= step
          break
        case 'right':
          x += step
          break
      }

      node.updateDashboardRect({ x, y })
    }
  }

  return {
    moveUp: () => moveNodes('up', MOVE_STEP.NORMAL),
    moveDown: () => moveNodes('down', MOVE_STEP.NORMAL),
    moveLeft: () => moveNodes('left', MOVE_STEP.NORMAL),
    moveRight: () => moveNodes('right', MOVE_STEP.NORMAL),
    moveUpLarge: () => moveNodes('up', MOVE_STEP.LARGE),
    moveDownLarge: () => moveNodes('down', MOVE_STEP.LARGE),
    moveLeftLarge: () => moveNodes('left', MOVE_STEP.LARGE),
    moveRightLarge: () => moveNodes('right', MOVE_STEP.LARGE),
  }
}
