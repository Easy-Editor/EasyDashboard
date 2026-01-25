/**
 * 快捷键映射常量
 * 使用 mod 代替 command/ctrl，会根据平台自动选择（Mac: meta, Windows: ctrl）
 */
export const HOTKEY_MAP = {
  // ========== 历史记录 ==========
  HISTORY_UNDO: ['mod+z'],
  HISTORY_REDO: ['mod+y', 'mod+shift+z'],

  // ========== 剪贴板操作 ==========
  COPY: ['mod+c'],
  PASTE: ['mod+v'],
  CUT: ['mod+x'],
  DUPLICATE: ['mod+d'],

  // ========== 选择操作 ==========
  SELECT_ALL: ['mod+a'],
  CLEAR_SELECTION: ['esc'],
  DELETE: ['backspace', 'del'],

  // ========== 图层操作 ==========
  LAYER_TOP: ['mod+shift+up'],
  LAYER_BOTTOM: ['mod+shift+down'],
  LAYER_UP: ['mod+up'],
  LAYER_DOWN: ['mod+down'],

  // ========== 分组操作 ==========
  GROUP: ['mod+g'],
  UNGROUP: ['mod+shift+g'],

  // ========== 可见性操作 ==========
  LOCK_UNLOCK: ['mod+shift+l'],
  SHOW_HIDE: ['mod+shift+h'],

  // ========== 移动操作 ==========
  MOVE_UP: ['up'],
  MOVE_DOWN: ['down'],
  MOVE_LEFT: ['left'],
  MOVE_RIGHT: ['right'],
  MOVE_UP_LARGE: ['shift+up'],
  MOVE_DOWN_LARGE: ['shift+down'],
  MOVE_LEFT_LARGE: ['shift+left'],
  MOVE_RIGHT_LARGE: ['shift+right'],

  // ========== 项目操作 ==========
  SAVE: ['mod+s'],
} as const

export type HotkeyAction = keyof typeof HOTKEY_MAP

/** 移动步长配置 */
export const MOVE_STEP = {
  NORMAL: 1,
  LARGE: 10,
} as const
