import { describe, expect, it } from 'vitest'

import configure from './configure'

describe('root configure', () => {
  it('keeps project resolution out of the selected-node property panel', () => {
    const serializedConfigure = JSON.stringify(configure.props)

    expect(serializedConfigure).not.toContain('ResolutionSetter')
    expect(serializedConfigure).not.toContain('__resolution')
    expect(serializedConfigure).toContain('全局属性')
  })
})
