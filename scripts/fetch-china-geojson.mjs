import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const easyEditorRoot = resolve(projectRoot, '../EasyEditor')
const sourceCommit = 'c5a48f5f97d23e5379720870b8444cd05b50ffb4'
const sourceUrl = `https://raw.githubusercontent.com/apache/echarts/${sourceCommit}/test/data/map/js/china.js`
const tolerance = 0.025

const response = await fetch(sourceUrl)
if (!response.ok) throw new Error(`Could not fetch pinned Apache ECharts map source (${response.status})`)
const source = await response.text()
if (!source.includes('Licensed to the Apache Software Foundation')) {
  throw new Error('Pinned map source license header is missing')
}

const startMarker = 'const geoJSON = '
const start = source.indexOf(startMarker)
const end = source.indexOf(';', start + startMarker.length)
if (start < 0 || end < 0) throw new Error('Pinned map source shape changed')
const parsed = JSON.parse(source.slice(start + startMarker.length, end))

const squaredDistanceToSegment = (point, startPoint, endPoint) => {
  let x = startPoint[0]
  let y = startPoint[1]
  let dx = endPoint[0] - x
  let dy = endPoint[1] - y
  if (dx !== 0 || dy !== 0) {
    const ratio = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy)
    if (ratio > 1) {
      x = endPoint[0]
      y = endPoint[1]
    } else if (ratio > 0) {
      x += dx * ratio
      y += dy * ratio
    }
  }
  dx = point[0] - x
  dy = point[1] - y
  return dx * dx + dy * dy
}

const simplifyLine = points => {
  if (points.length <= 4) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  const squaredTolerance = tolerance * tolerance
  while (stack.length) {
    const [first, last] = stack.pop()
    let maxDistance = 0
    let maxIndex = 0
    for (let index = first + 1; index < last; index += 1) {
      const distance = squaredDistanceToSegment(points[index], points[first], points[last])
      if (distance > maxDistance) {
        maxDistance = distance
        maxIndex = index
      }
    }
    if (maxDistance > squaredTolerance) {
      keep[maxIndex] = 1
      stack.push([first, maxIndex], [maxIndex, last])
    }
  }
  const simplified = points.filter((_, index) => keep[index] === 1)
  if (simplified.length < 4) return points.slice(0, 4)
  return simplified
}

const roundPoint = point => [Number(point[0].toFixed(4)), Number(point[1].toFixed(4))]
const simplifyRing = ring => simplifyLine(ring.map(roundPoint))
const simplifyPolygon = polygon => polygon.map(simplifyRing)
const simplifyGeometry = geometry => ({
  type: geometry.type,
  coordinates:
    geometry.type === 'Polygon' ? simplifyPolygon(geometry.coordinates) : geometry.coordinates.map(simplifyPolygon),
})

const features = parsed.features
  .filter(feature => feature?.geometry?.type === 'Polygon' || feature?.geometry?.type === 'MultiPolygon')
  .map(feature => ({
    type: 'Feature',
    properties: {
      name: feature.properties?.name,
      ...(Number.isFinite(feature.properties?.lng) ? { lng: feature.properties.lng } : {}),
      ...(Number.isFinite(feature.properties?.lat) ? { lat: feature.properties.lat } : {}),
    },
    geometry: simplifyGeometry(feature.geometry),
  }))

if (features.length < 34) throw new Error(`Expected at least 34 province features, received ${features.length}`)

const output = `${JSON.stringify({
  type: 'FeatureCollection',
  easyDashboardSource: {
    sourceUrl,
    sourceCommit,
    license: 'Apache-2.0',
    simplificationToleranceDegrees: tolerance,
  },
  features,
})}\n`

const targets = [
  resolve(projectRoot, 'src/editor/materials/dashboard-scene/china-provinces.geo.json'),
  resolve(easyEditorRoot, 'examples/dashboard/src/editor/materials/inner/dashboard-scene/china-provinces.geo.json'),
]

for (const target of targets) {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, output, 'utf8')
}

process.stdout.write(
  `Wrote ${features.length} province features (${Buffer.byteLength(output)} bytes) from pinned Apache ECharts source.\n`,
)
