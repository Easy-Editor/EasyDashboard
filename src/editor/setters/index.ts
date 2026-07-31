import ColorSetter from './color-setter'
import DataSetter from './data-setter'
import EventSetter from './event-setter'
import NodeInfoSetter from './node-info-setter'

/**
 * 设置器
 */
export const setterMap = {
  DataSetter,
  EventSetter,
  NodeInfoSetter,
}

/**
 * Remote setters provide the common baseline. These application-owned
 * implementations are applied afterwards so EasyDashboard can keep its own
 * interaction and React compatibility guarantees.
 */
export const setterOverrides = {
  ColorSetter,
}

export * from './CustomFieldItem'
