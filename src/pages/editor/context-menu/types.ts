export enum SelectionType {
  NONE = 'none',
  SINGLE = 'single',
  MULTIPLE = 'multiple',
}

export interface MenuItem {
  key: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  children?: MenuItem[]
  separator?: boolean
  shortcut?: string
  onClick?: () => void
}
