import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  Clipboard,
  ClipboardCopy,
  ClipboardPaste,
  ClipboardPen,
  Eye,
  Group,
  Layers,
  Lock,
  PanelBottom,
  PanelTop,
  Redo2,
  RefreshCw,
  Scissors,
  Trash2,
  Undo2,
  Ungroup,
} from 'lucide-react'
import {
  alignHandlers,
  clipboardHandlers,
  groupHandlers,
  historyHandlers,
  layerHandlers,
  nodeHandlers,
  visibilityHandlers,
} from './menuHandlers'
import type { MenuItem } from './types'
import { SelectionType } from './types'

/**
 * 所有菜单项定义
 */
export const menuItems: MenuItem[] = [
  {
    key: 'layer',
    label: '图层',
    icon: Layers,
    children: [
      { key: 'layer-top', label: '置顶', icon: PanelTop, shortcut: '⌘⇧↑', onClick: layerHandlers.top },
      { key: 'layer-bottom', label: '置底', icon: PanelBottom, shortcut: '⌘⇧↓', onClick: layerHandlers.bottom },
      { key: 'layer-up', label: '上移一层', icon: ArrowUp, shortcut: '⌘↑', onClick: layerHandlers.up },
      { key: 'layer-down', label: '下移一层', icon: ArrowDown, shortcut: '⌘↓', onClick: layerHandlers.down },
    ],
  },
  {
    key: 'align',
    label: '对齐',
    icon: AlignCenterVertical,
    children: [
      { key: 'align-left', label: '左对齐', icon: AlignStartVertical, onClick: alignHandlers.left },
      { key: 'align-right', label: '右对齐', icon: AlignEndVertical, onClick: alignHandlers.right },
      { key: 'align-top', label: '上对齐', icon: AlignStartHorizontal, onClick: alignHandlers.top },
      { key: 'align-bottom', label: '下对齐', icon: AlignEndHorizontal, onClick: alignHandlers.bottom },
      { key: 'align-h-center', label: '水平居中', icon: AlignCenterVertical, onClick: alignHandlers.horizontalCenter },
      {
        key: 'align-v-center',
        label: '垂直居中',
        icon: AlignCenterHorizontal,
        separator: true,
        onClick: alignHandlers.verticalCenter,
      },
      {
        key: 'distribute-h',
        label: '水平分布',
        icon: AlignHorizontalDistributeCenter,
        onClick: alignHandlers.distributeHorizontal,
      },
      {
        key: 'distribute-v',
        label: '垂直分布',
        icon: AlignVerticalDistributeCenter,
        onClick: alignHandlers.distributeVertical,
      },
    ],
  },
  { key: 'group', label: '成组', icon: Group, shortcut: '⌘G', onClick: groupHandlers.group },
  {
    key: 'ungroup',
    label: '取消成组',
    icon: Ungroup,
    shortcut: '⌘⇧G',
    separator: true,
    onClick: groupHandlers.ungroup,
  },
  { key: 'copy', label: '复制', icon: ClipboardCopy, shortcut: '⌘C', onClick: clipboardHandlers.copy },
  { key: 'cut', label: '剪切', icon: Scissors, shortcut: '⌘X', onClick: clipboardHandlers.cut },
  { key: 'paste', label: '粘贴', icon: ClipboardPaste, shortcut: '⌘V', onClick: clipboardHandlers.paste },
  { key: 'cv', label: '拷贝', icon: ClipboardPen, shortcut: '⌘D', onClick: clipboardHandlers.duplicate },
  {
    key: 'copy-paste-as',
    label: '...复制/粘贴为',
    icon: Clipboard,
    separator: true,
    children: [
      { key: 'copy-component-style', label: '复制组件样式' },
      { key: 'paste-component-style', label: '粘贴组件样式' },
      { key: 'copy-component-event', label: '复制组件事件' },
      { key: 'paste-component-event', label: '粘贴组件事件' },
    ],
  },
  { key: 'show', label: '显示', icon: Eye, shortcut: '⌘⇧H', onClick: visibilityHandlers.show },
  { key: 'hide', label: '隐藏', icon: Eye, shortcut: '⌘⇧H', onClick: visibilityHandlers.hide },
  { key: 'unlock', label: '解锁', icon: Lock, shortcut: '⌘⇧L', separator: true, onClick: visibilityHandlers.unlock },
  { key: 'lock', label: '锁定', icon: Lock, shortcut: '⌘⇧L', separator: true, onClick: visibilityHandlers.lock },
  { key: 'check-updates', label: '检查组件更新', icon: RefreshCw, separator: true },
  { key: 'undo', label: '撤销', icon: Undo2, shortcut: '⌘Z', onClick: historyHandlers.undo },
  { key: 'redo', label: '重做', icon: Redo2, shortcut: '⌘Y', separator: true, onClick: historyHandlers.redo },
  { key: 'delete', label: '删除', icon: Trash2, shortcut: 'Del', onClick: nodeHandlers.delete },
]

/**
 * 根据选择类型获取可用菜单项
 */
export const getMenuItems = (selectionType: SelectionType): MenuItem[] => {
  const keyMap: Record<SelectionType, string[]> = {
    [SelectionType.NONE]: ['paste', 'undo', 'redo', 'check-updates'],
    [SelectionType.SINGLE]: [
      'layer',
      'group',
      'ungroup',
      'copy',
      'cut',
      'paste',
      'cv',
      'copy-paste-as',
      'hide',
      'lock',
      'undo',
      'redo',
      'check-updates',
      'delete',
    ],
    [SelectionType.MULTIPLE]: [
      'layer',
      'align',
      'group',
      'ungroup',
      'copy',
      'cut',
      'paste',
      'cv',
      'hide',
      'lock',
      'undo',
      'redo',
      'check-updates',
      'delete',
    ],
  }

  const keys = keyMap[selectionType] || []
  return menuItems.filter(item => keys.includes(item.key))
}
