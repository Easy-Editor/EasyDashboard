import { describe, expect, it } from 'vitest'

import { addComponentNameAliases, parseVersionedName } from './utils'

describe('parseVersionedName', () => {
  it('provides the plain component alias used by persisted dashboard nodes', () => {
    expect(parseVersionedName('Text@0.0.22')).toEqual({ name: 'Text', version: '0.0.22' })
    expect(parseVersionedName('Text')).toBeNull()
  })

  it('registers a remote component under both its pinned and persisted names', () => {
    const component = Symbol('Text component')
    const components: Record<string, symbol> = {}

    addComponentNameAliases(components, 'Text@0.0.22', component)

    expect(components).toEqual({
      Text: component,
      'Text@0.0.22': component,
    })
  })
})
