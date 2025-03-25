import type { Component, ComponentMetadata } from '@easy-editor/core'
import { formatMapFromESModule } from '../utils'

const componentMap = await import('./component')
const componentMetaMap = await import('./meta')

export const components = formatMapFromESModule<Component>(componentMap)
export const componentMetas = formatMapFromESModule<ComponentMetadata>(componentMetaMap)
