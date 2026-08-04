import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { detectAssetType, extractAssetText } from './asset-extractor.js'

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function uint16(value: number): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value)
  return buffer
}

function zip(entries: Record<string, string>): Uint8Array {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name)
    const source = Buffer.from(value)
    const compressed = deflateRawSync(source)
    const local = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0),
      uint16(8),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(compressed.length),
      uint32(source.length),
      uint16(nameBytes.length),
      uint16(0),
      nameBytes,
      compressed,
    ])
    localParts.push(local)
    centralParts.push(
      Buffer.concat([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0),
        uint16(8),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(compressed.length),
        uint32(source.length),
        uint16(nameBytes.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(localOffset),
        nameBytes,
      ]),
    )
    localOffset += local.length
  }
  const central = Buffer.concat(centralParts)
  const end = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(centralParts.length),
    uint16(centralParts.length),
    uint32(central.length),
    uint32(localOffset),
    uint16(0),
  ])
  return Buffer.concat([...localParts, central, end])
}

function understateFirstCentralEntrySize(archive: Uint8Array, declaredSize: number): Uint8Array {
  const buffer = Buffer.from(archive)
  for (let offset = 0; offset + 46 <= buffer.length; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue
    buffer.writeUInt32LE(declaredSize, offset + 24)
    return buffer
  }
  throw new Error('ZIP central directory entry was not found')
}

describe('Agent asset extraction', () => {
  it('extracts shared and inline XLSX cells into readable sheet rows', () => {
    const workbook = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="经营数据" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>区域</t></si><si><t>华东</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>销售额</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>8260</v></c></row></sheetData></worksheet>',
    })

    expect(detectAssetType(XLSX_CONTENT_TYPE, workbook)).toBe(XLSX_CONTENT_TYPE)
    expect(extractAssetText(XLSX_CONTENT_TYPE, workbook)).toEqual({
      supported: true,
      text: '# 经营数据\n区域\t销售额\n华东\t8260',
    })
  })

  it('fails closed for a malformed XLSX archive without crashing completion', () => {
    const malformed = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    expect(extractAssetText(XLSX_CONTENT_TYPE, malformed)).toEqual({ supported: true, text: null })
  })

  it('fails closed when an XLSX contains too many worksheet entries', () => {
    const worksheets = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [
        `xl/worksheets/sheet${index + 1}.xml`,
        '<worksheet><sheetData><row><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
      ]),
    )
    const workbook = zip(worksheets)

    expect(extractAssetText(XLSX_CONTENT_TYPE, workbook)).toEqual({ supported: true, text: null })
  })

  it('fails closed when the central directory understates an extreme-compression XML member', () => {
    const workbook = understateFirstCentralEntrySize(
      zip({
        'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row><c r="A1"><v>ratio-bypass</v></c></row></sheetData>${' '.repeat(1024 * 1024)}</worksheet>`,
      }),
      1024,
    )

    expect(extractAssetText(XLSX_CONTENT_TYPE, workbook)).toEqual({ supported: true, text: null })
  })
})
