import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GLOBE_SCENE_SPEC,
  buildOrthographicLandPath,
  normalizeGlobeSceneSpec,
  parseGlobeShaderColor,
  projectOrthographic,
} from './spec'
import worldGeoJsonRaw from './world.geo.json?raw'

describe('GlobeScene spec', () => {
  it('normalizes bounded pure-data options and rejects unsafe marker content', () => {
    const markers = Array.from({ length: 30 }, (_, index) => ({
      latitude: index - 20,
      longitude: index * 4,
      label: `marker-${index}`.repeat(8),
      color: index === 0 ? 'url(https://example.com/track)' : '#65e8ff',
      value: index,
      script: 'alert(1)',
    }))
    const normalized = normalizeGlobeSceneSpec({
      ambientLight: -2,
      atmosphereColor: 'javascript:alert(1)',
      centerLatitude: 120,
      centerLongitude: -240,
      globeScale: 9,
      daylightIntensity: 8,
      introDuration: 40,
      rotationSpeed: 99,
      starDensity: -3,
      surfaceBrightness: 9,
      lightAzimuth: 270,
      markers,
    })

    expect(normalized).toMatchObject({
      ambientLight: 0.04,
      atmosphereColor: DEFAULT_GLOBE_SCENE_SPEC.atmosphereColor,
      centerLatitude: 70,
      centerLongitude: -180,
      globeScale: 1.45,
      daylightIntensity: 1.4,
      introDuration: 600,
      rotationSpeed: 8,
      starDensity: 0,
      surfaceBrightness: 1.2,
      lightAzimuth: 180,
    })
    expect(normalized.markers).toHaveLength(24)
    expect(normalized.markers[0]).toEqual({
      latitude: -20,
      longitude: 0,
      label: expect.any(String),
      color: DEFAULT_GLOBE_SCENE_SPEC.atmosphereColor,
      value: 0,
    })
    expect(normalized.markers[0]?.label?.length).toBeLessThanOrEqual(36)
    expect(normalized.markers[0]).not.toHaveProperty('script')
  })

  it('uses a true front-hemisphere orthographic projection centered on Asia-Pacific', () => {
    const center = projectOrthographic(118, 18, 118, 18, 410)
    const beijing = projectOrthographic(116.4, 39.9, 118, 18, 410)
    const newYork = projectOrthographic(-74, 40.7, 118, 18, 410)

    expect(center.visible).toBe(true)
    expect(center.depth).toBeCloseTo(1)
    expect(center.x).toBeCloseTo(0)
    expect(center.y).toBeCloseTo(0)
    expect(beijing.visible).toBe(true)
    expect(Math.hypot(beijing.x, beijing.y)).toBeLessThan(220)
    expect(newYork.visible).toBe(false)
    expect(newYork.depth).toBeLessThan(0)
  })

  it('keeps shader colors and their WebGL RGB conversion on one hex contract', () => {
    const normalized = normalizeGlobeSceneSpec({
      atmosphereColor: '#6bcf',
      landColor: '#173f69cc',
      oceanColor: 'rgb(4 22 44)',
      background: 'rgb(2 8 20)',
    })

    expect(normalized).toMatchObject({
      atmosphereColor: '#6bcf',
      landColor: '#173f69cc',
      oceanColor: DEFAULT_GLOBE_SCENE_SPEC.oceanColor,
      background: 'rgb(2 8 20)',
    })
    expect(parseGlobeShaderColor('#6bcf')).toEqual([0.4, 187 / 255, 204 / 255])
    expect(parseGlobeShaderColor('#173f69cc')).toEqual([23 / 255, 63 / 255, 105 / 255])
    expect(parseGlobeShaderColor('rebeccapurple')).toBeNull()
  })

  it('projects the bundled world GeoJSON and falls back to a non-empty land silhouette', () => {
    const world = buildOrthographicLandPath(JSON.parse(worldGeoJsonRaw), 118, 18)
    const fallback = buildOrthographicLandPath({ type: 'FeatureCollection', features: [] }, 118, 18)

    expect(world.usedFallback).toBe(false)
    expect(world.ringCount).toBeGreaterThan(20)
    expect(world.d).toMatch(/^M/u)
    expect(fallback.usedFallback).toBe(true)
    expect(fallback.ringCount).toBeGreaterThan(0)
    expect(fallback.d).toMatch(/^M/u)
  })
})
