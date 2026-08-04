import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Div from './component'

describe('Div material', () => {
  it('renders children and configured container decoration', () => {
    const markup = renderToStaticMarkup(
      <Div
        background='linear-gradient(90deg, #fff, #eee)'
        borderColor='#c6a66b'
        borderRadius={12}
        borderWidth={2}
        opacity={80}
        overflow='hidden'
        panelInset={28}
        panelShape='hud-left'
        visualPreset='metric-axis'
        shadowBlur={16}
        shadowColor='rgba(0, 0, 0, 0.2)'
        shadowOffsetY={6}
      >
        <span>区域内容</span>
      </Div>,
    )

    expect(markup).toContain('区域内容')
    expect(markup).toContain('border:2px solid #c6a66b')
    expect(markup).toContain('border-radius:12px')
    expect(markup).toContain('box-shadow:0 6px 16px rgba(0, 0, 0, 0.2)')
    expect(markup).toContain('opacity:0.8')
    expect(markup).toContain('overflow:hidden')
    expect(markup).toContain('data-div-panel-shape="hud-left"')
    expect(markup).toContain('data-div-visual-preset="metric-axis"')
    expect(markup).toContain('radial-gradient(circle at 50% 5px')
    expect(markup).toContain('clip-path:polygon(0 0, calc(100% - 28px) 28px, 100% calc(100% - 28px), 0 100%)')
  })

  it('clamps unsafe numeric presentation values', () => {
    const markup = renderToStaticMarkup(
      <Div
        borderRadius={-8}
        borderWidth={-2}
        opacity={180}
        panelInset={200}
        panelShape={'unknown' as any}
        visualPreset={'unknown' as any}
      />,
    )

    expect(markup).toContain('border:0px solid transparent')
    expect(markup).toContain('border-radius:0')
    expect(markup).toContain('opacity:1')
    expect(markup).toContain('data-div-panel-shape="rect"')
    expect(markup).toContain('data-div-visual-preset="none"')
    expect(markup).not.toContain('clip-path:')
  })

  it('renders a bounded staged entrance animation as pure data-driven CSS', () => {
    const markup = renderToStaticMarkup(
      <Div enterAnimation='slide-left' enterDelay={240} enterDuration={900} opacity={80} />,
    )

    expect(markup).toContain('data-div-enter-animation="slide-left"')
    expect(markup).toContain('--div-enter-final-opacity:0.8')
    expect(markup).toContain('animation-delay:240ms')
    expect(markup).toContain('animation-duration:900ms')
    expect(markup).toContain('animation-name:easy-dashboard-div-enter-slide-left')
  })
})
