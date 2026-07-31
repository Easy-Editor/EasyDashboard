import type { PluginCreator } from '@easy-editor/core'
import { HOTKEY_MAP, type HotkeyAction } from './const'
import {
  createClipboardHandlers,
  createGroupHandlers,
  createHistoryHandlers,
  createLayerHandlers,
  createMovementHandlers,
  createProjectHandlers,
  createSelectionHandlers,
  createVisibilityHandlers,
} from './handlers'
import { isFormEvent } from './utils'

export interface HotkeyPluginOptions {
  disabled?: HotkeyAction[]
  customKeys?: Partial<Record<HotkeyAction, string[]>>
}

const HotkeyPlugin: PluginCreator<HotkeyPluginOptions> = (options = {}) => {
  const { disabled = [], customKeys = {} } = options

  return {
    name: 'HotkeyPlugin',
    deps: ['DashboardPlugin'],
    init(ctx) {
      const { hotkey, project, logger } = ctx

      const historyHandlers = createHistoryHandlers(project)
      const clipboardHandlers = createClipboardHandlers(project)
      const selectionHandlers = createSelectionHandlers(project)
      const layerHandlers = createLayerHandlers(project)
      const groupHandlers = createGroupHandlers(project)
      const visibilityHandlers = createVisibilityHandlers(project)
      const movementHandlers = createMovementHandlers(project)
      const projectHandlers = createProjectHandlers()

      // 返回 false 会阻止默认行为
      const handlers: Record<HotkeyAction, (e: KeyboardEvent) => any> = {
        HISTORY_UNDO: () => {
          historyHandlers.undo()
          return false
        },
        HISTORY_REDO: () => {
          historyHandlers.redo()
          return false
        },
        COPY: e => {
          if (isFormEvent(e)) return
          clipboardHandlers.copy()
        },
        CUT: e => {
          if (isFormEvent(e)) return
          clipboardHandlers.cut()
        },
        PASTE: e => {
          if (isFormEvent(e)) return
          clipboardHandlers.paste(e)
        },
        DUPLICATE: e => {
          if (isFormEvent(e)) return
          clipboardHandlers.duplicate()
          return false
        },
        SELECT_ALL: e => {
          if (isFormEvent(e)) return
          selectionHandlers.selectAll()
          return false
        },
        CLEAR_SELECTION: e => {
          if (isFormEvent(e)) return
          selectionHandlers.clearSelection()
        },
        DELETE: e => {
          if (isFormEvent(e)) return
          selectionHandlers.delete()
        },
        LAYER_TOP: () => {
          layerHandlers.layerTop()
          return false
        },
        LAYER_BOTTOM: () => {
          layerHandlers.layerBottom()
          return false
        },
        LAYER_UP: () => {
          layerHandlers.layerUp()
          return false
        },
        LAYER_DOWN: () => {
          layerHandlers.layerDown()
          return false
        },
        GROUP: () => {
          groupHandlers.group()
          return false
        },
        UNGROUP: () => {
          groupHandlers.ungroup()
          return false
        },
        LOCK_UNLOCK: () => {
          visibilityHandlers.toggleLock()
          return false
        },
        SHOW_HIDE: () => {
          visibilityHandlers.toggleVisibility()
          return false
        },
        MOVE_UP: e => {
          if (isFormEvent(e)) return
          movementHandlers.moveUp()
          return false
        },
        MOVE_DOWN: e => {
          if (isFormEvent(e)) return
          movementHandlers.moveDown()
          return false
        },
        MOVE_LEFT: e => {
          if (isFormEvent(e)) return
          movementHandlers.moveLeft()
          return false
        },
        MOVE_RIGHT: e => {
          if (isFormEvent(e)) return
          movementHandlers.moveRight()
          return false
        },
        MOVE_UP_LARGE: e => {
          if (isFormEvent(e)) return
          movementHandlers.moveUpLarge()
          return false
        },
        MOVE_DOWN_LARGE: e => {
          if (isFormEvent(e)) return
          movementHandlers.moveDownLarge()
          return false
        },
        MOVE_LEFT_LARGE: e => {
          if (isFormEvent(e)) return
          movementHandlers.moveLeftLarge()
          return false
        },
        MOVE_RIGHT_LARGE: e => {
          if (isFormEvent(e)) return
          movementHandlers.moveRightLarge()
          return false
        },
        SAVE: () => {
          projectHandlers.save()
          return false
        },
      }

      Object.entries(HOTKEY_MAP).forEach(([action, defaultKeys]) => {
        const actionKey = action as HotkeyAction

        if (disabled.includes(actionKey)) {
          logger.log(`Hotkey ${actionKey} is disabled`)
          return
        }

        const keys = customKeys[actionKey] ?? [...defaultKeys]
        const handler = handlers[actionKey]

        if (handler && keys.length) {
          hotkey.bind(keys, handler)
        }
      })

      logger.log('HotkeyPlugin initialized')
    },
  }
}

export default HotkeyPlugin
export { HOTKEY_MAP } from './const'
