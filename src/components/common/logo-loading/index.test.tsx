import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LogoLoading } from '.'

describe('LogoLoading', () => {
  it('announces a concise Chinese loading state', () => {
    const html = renderToStaticMarkup(<LogoLoading />)

    expect(html).toContain('<output')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('正在加载…')
    expect(html).not.toContain('LOADING')
  })
})
