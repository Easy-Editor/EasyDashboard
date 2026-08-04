import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CalibrationViewport } from './CalibrationViewport'

describe('CalibrationViewport', () => {
  it('uses natural Chinese labels for draft and empty states', () => {
    const html = renderToStaticMarkup(<CalibrationViewport state='DRAFT' preview='blank' />)

    expect(html).toContain('1920 × 1080 · 草稿')
    expect(html).toContain('等待添加内容')
    expect(html).not.toMatch(/VIEWPORT|Layout pending|DRAFT/)
  })
})
