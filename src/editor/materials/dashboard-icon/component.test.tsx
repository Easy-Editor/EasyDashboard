import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import DashboardIcon from './component'

describe('DashboardIcon material', () => {
  it('renders a semantic configurable line icon without text glyph fallbacks', () => {
    const markup = renderToStaticMarkup(<DashboardIcon icon='sprout' color='#8fdcff' padding={6} strokeWidth={1.5} />)

    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="图标：sprout"')
    expect(markup).toContain('color:#8fdcff')
    expect(markup).toContain('padding:6px')
    expect(markup).not.toContain('◆')
  })
})
