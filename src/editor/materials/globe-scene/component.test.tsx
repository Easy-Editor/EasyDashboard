import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import GlobeScene from './component'

describe('GlobeScene material', () => {
  it('renders fixed NASA visual assets, a WebGL sphere and a real-texture fallback without remote URLs', () => {
    const markup = renderToStaticMarkup(
      <GlobeScene autoRotate={false} introAnimation={true} introDuration={2700} starDensity={0.72} />,
    )

    expect(markup).toContain('data-globe-scene="ready"')
    expect(markup).toContain('data-globe-scene-background="nasa-2mass"')
    expect(markup).toContain('data-globe-scene-asset="nasa-2mass-galactic-plane"')
    expect(markup).toContain('data-globe-scene-asset="nasa-blue-marble"')
    expect(markup).toContain('data-globe-scene-renderer="pending"')
    expect(markup).toContain('data-globe-scene-earth-fallback="texture-mask"')
    expect(markup).toContain('data-globe-scene-marker="北京"')
    expect(markup).not.toContain('<svg')
    expect(markup).not.toContain('http://')
    expect(markup).not.toContain('https://')
  })

  it('vendors valid non-trivial JPEG assets instead of generated CSS scenery', async () => {
    const [earth, galaxy, sources] = await Promise.all([
      readFile(new URL('./assets/earth-blue-marble.jpg', import.meta.url)),
      readFile(new URL('./assets/2mass-galactic-plane.jpg', import.meta.url)),
      readFile(new URL('./assets/SOURCES.md', import.meta.url), 'utf8'),
    ])

    expect([...earth.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect([...galaxy.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect(earth.byteLength).toBeGreaterThan(400_000)
    expect(galaxy.byteLength).toBeGreaterThan(150_000)
    expect(sources).toContain('https://svs.gsfc.nasa.gov/3615/')
    expect(sources).toContain('https://svs.gsfc.nasa.gov/30020/')
  })

  it('sizes the globe and scan rings from the container shorter side', async () => {
    const css = await readFile(new URL('./component.css', import.meta.url), 'utf8')

    expect(css).toContain('container-type: size')
    expect(css).toContain('width: min(86cqmin, 860px)')
    expect(css).toContain('height: min(86cqmin, 860px)')
    expect(css).toContain('width: min(89cqmin, 920px)')
    expect(css).toContain('height: min(89cqmin, 920px)')
  })
})
