import { inflateRawSync } from 'node:zlib'

const MAX_EXTRACTED_CHARS = 100_000
const MAX_XLSX_XML_BYTES = 4 * 1024 * 1024
const MAX_XLSX_TOTAL_XML_BYTES = 16 * 1024 * 1024
const MAX_XLSX_ARCHIVE_ENTRIES = 2_048
const MAX_XLSX_RELEVANT_ENTRIES = 128
const MAX_XLSX_COMPRESSION_RATIO = 500
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type AssetExtraction = { text: string | null; supported: boolean }

function byteView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/gu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&')
}

function xmlAttribute(attributes: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = attributes.match(new RegExp(`(?:^|\\s)${escaped}=(?:"([^"]*)"|'([^']*)')`, 'u'))
  return match ? decodeXml(match[1] ?? match[2] ?? '') : null
}

function xmlText(block: string): string {
  return [...block.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map(match => decodeXml(match[1] ?? '')).join('')
}

function normalizedZipPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+/, '').replace(/^\.\//u, '')
}

function readXlsxXmlEntries(bytes: Uint8Array): Map<string, string> {
  const view = byteView(bytes)
  let endOfCentralDirectory = -1
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOfCentralDirectory = offset
      break
    }
  }
  if (endOfCentralDirectory < 0) return new Map()

  const entryCount = view.getUint16(endOfCentralDirectory + 10, true)
  if (entryCount > MAX_XLSX_ARCHIVE_ENTRIES) return new Map()
  let offset = view.getUint32(endOfCentralDirectory + 16, true)
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const entries = new Map<string, string>()
  let relevantEntryCount = 0
  let declaredXmlBytes = 0
  let inflatedXmlBytes = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) break
    const compression = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const fileNameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const fileNameStart = offset + 46
    const name = normalizedZipPath(decoder.decode(bytes.slice(fileNameStart, fileNameStart + fileNameLength)))
    offset = fileNameStart + fileNameLength + extraLength + commentLength

    const relevant =
      name === 'xl/workbook.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      name === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/[^/]+\.xml$/u.test(name)
    if (!relevant) continue
    relevantEntryCount += 1
    declaredXmlBytes += uncompressedSize
    if (
      relevantEntryCount > MAX_XLSX_RELEVANT_ENTRIES ||
      uncompressedSize > MAX_XLSX_XML_BYTES ||
      declaredXmlBytes > MAX_XLSX_TOTAL_XML_BYTES ||
      compressedSize > bytes.byteLength ||
      (uncompressedSize > 0 && compressedSize === 0) ||
      uncompressedSize / Math.max(compressedSize, 1) > MAX_XLSX_COMPRESSION_RATIO
    ) {
      return new Map()
    }
    if (localHeaderOffset + 30 > bytes.byteLength || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      return new Map()
    }

    const localNameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataStart < 0 || dataEnd > bytes.byteLength) return new Map()

    const compressed = bytes.slice(dataStart, dataEnd)
    let extracted: Uint8Array
    if (compression === 0) extracted = compressed
    else if (compression === 8) {
      try {
        extracted = inflateRawSync(compressed, {
          maxOutputLength: Math.min(MAX_XLSX_XML_BYTES, MAX_XLSX_TOTAL_XML_BYTES - inflatedXmlBytes),
        })
      } catch {
        return new Map()
      }
    } else return new Map()
    inflatedXmlBytes += extracted.byteLength
    if (
      extracted.byteLength > MAX_XLSX_XML_BYTES ||
      inflatedXmlBytes > MAX_XLSX_TOTAL_XML_BYTES ||
      extracted.byteLength / Math.max(compressedSize, 1) > MAX_XLSX_COMPRESSION_RATIO
    ) {
      return new Map()
    }
    entries.set(name, decoder.decode(extracted))
  }
  return entries
}

function worksheetColumnIndex(reference: string | null): number | null {
  const letters = reference?.match(/^([A-Z]+)/iu)?.[1]?.toUpperCase()
  if (!letters) return null
  let index = 0
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64
  return index - 1
}

function extractWorksheetRows(xml: string, sharedStrings: string[]): string[] {
  const lines: string[] = []
  let extractedCharacters = 0
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
    const cells: string[] = []
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)) {
      const attributes = cellMatch[1] ?? ''
      const body = cellMatch[2] ?? ''
      const type = xmlAttribute(attributes, 't')
      const reference = xmlAttribute(attributes, 'r')
      const inlineValue = xmlText(body)
      const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/u)?.[1]
      let value = inlineValue || (rawValue === undefined ? '' : decodeXml(rawValue))
      if (type === 's' && rawValue !== undefined) value = sharedStrings[Number.parseInt(rawValue, 10)] ?? ''
      if (type === 'b' && rawValue !== undefined) value = rawValue === '1' ? 'TRUE' : 'FALSE'

      const column = worksheetColumnIndex(reference)
      if (column !== null && column < 100) {
        while (cells.length < column) cells.push('')
        cells[column] = value
      } else cells.push(value)
    }
    while (cells.at(-1) === '') cells.pop()
    if (cells.length > 0) {
      const line = cells.join('\t')
      lines.push(line)
      extractedCharacters += line.length + (lines.length > 1 ? 1 : 0)
    }
    if (extractedCharacters >= MAX_EXTRACTED_CHARS) break
  }
  return lines
}

function extractXlsxText(bytes: Uint8Array): string | null {
  const entries = readXlsxXmlEntries(bytes)
  if (entries.size === 0) return null
  const sharedStrings = [...(entries.get('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)].map(
    match => xmlText(match[1] ?? ''),
  )
  const workbook = entries.get('xl/workbook.xml') ?? ''
  const relationships = entries.get('xl/_rels/workbook.xml.rels') ?? ''
  const relationshipTargets = new Map<string, string>()
  for (const match of relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/gu)) {
    const id = xmlAttribute(match[1] ?? '', 'Id')
    const target = xmlAttribute(match[1] ?? '', 'Target')
    if (id && target) relationshipTargets.set(id, normalizedZipPath(target.startsWith('/') ? target : `xl/${target}`))
  }

  const orderedSheets: Array<{ name: string; path: string }> = []
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/gu)) {
    const attributes = match[1] ?? ''
    const name = xmlAttribute(attributes, 'name') ?? `Sheet ${orderedSheets.length + 1}`
    const relationshipId = xmlAttribute(attributes, 'r:id')
    const path = relationshipId ? relationshipTargets.get(relationshipId) : undefined
    if (path && entries.has(path)) orderedSheets.push({ name, path })
  }
  if (orderedSheets.length === 0) {
    for (const path of [...entries.keys()].filter(name => /^xl\/worksheets\/[^/]+\.xml$/u.test(name)).sort()) {
      orderedSheets.push({ name: `Sheet ${orderedSheets.length + 1}`, path })
    }
  }

  const output: string[] = []
  let outputCharacters = 0
  for (const sheet of orderedSheets) {
    const rows = extractWorksheetRows(entries.get(sheet.path) ?? '', sharedStrings)
    if (rows.length === 0) continue
    for (const line of [`# ${sheet.name}`, ...rows]) {
      output.push(line)
      outputCharacters += line.length + (output.length > 1 ? 1 : 0)
      if (outputCharacters >= MAX_EXTRACTED_CHARS) break
    }
    if (outputCharacters >= MAX_EXTRACTED_CHARS) break
  }
  return output.join('\n').slice(0, MAX_EXTRACTED_CHARS) || null
}

export function detectAssetType(contentType: string, bytes: Uint8Array): string | null {
  const type = contentType.toLowerCase()
  if (type === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return type
  if (type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) return type
  if (type === 'application/pdf' && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return type
  if (type === 'text/plain' || type === 'text/markdown' || type === 'text/csv') return type
  if (
    type === 'image/webp' &&
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return type
  if (type === 'image/svg+xml') return type
  if (type === XLSX_CONTENT_TYPE && new TextDecoder().decode(bytes.slice(0, 2)) === 'PK') return type
  return null
}

export function extractAssetText(contentType: string, bytes: Uint8Array): AssetExtraction {
  const type = contentType.toLowerCase()
  if (!detectAssetType(type, bytes)) return { text: null, supported: false }
  if (type === 'text/plain' || type === 'text/markdown' || type === 'text/csv' || type === 'image/svg+xml') {
    return {
      text: new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, MAX_EXTRACTED_CHARS),
      supported: true,
    }
  }
  if (type === 'application/pdf') {
    const raw = new TextDecoder('latin1').decode(bytes)
    const text = [...raw.matchAll(/\(([^()]*)\)/g)]
      .map(match => match[1])
      .join(' ')
      .replace(/\\[nrt]/g, ' ')
      .slice(0, MAX_EXTRACTED_CHARS)
    return { text: text || null, supported: true }
  }
  if (type === XLSX_CONTENT_TYPE) return { text: extractXlsxText(bytes), supported: true }
  return { text: null, supported: true }
}
