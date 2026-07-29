import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

type ViewerBuildAsset = { type: 'asset'; fileName: string; source: string | Uint8Array }
type ViewerBuildOutput = {
  output: Array<ViewerBuildAsset | { type: 'chunk'; fileName: string }>
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(currentDirectory, '../../..')

const previewUtilityContracts = [
  { className: ['h', 'screen'].join('-'), declaration: 'height:100vh' },
  { className: ['w', 'full'].join('-'), declaration: 'width:100%' },
  { className: ['overflow', 'hidden'].join('-'), declaration: 'overflow:hidden' },
  { className: ['bg', 'black'].join('-'), declaration: 'background-color:' },
]

describe('standalone Viewer stylesheet', () => {
  it('includes the shared preview layout utilities', async () => {
    const buildResult = await build({
      configFile: path.resolve(repositoryRoot, 'viewer/vite.config.mts'),
      root: path.resolve(repositoryRoot, 'viewer'),
      build: {
        write: false,
      },
      logLevel: 'silent',
    })
    const outputs = (Array.isArray(buildResult) ? buildResult : [buildResult]) as ViewerBuildOutput[]
    const css = outputs
      .flatMap(output => output.output)
      .filter((output): output is ViewerBuildAsset => output.type === 'asset' && output.fileName.endsWith('.css'))
      .map(output => (typeof output.source === 'string' ? output.source : new TextDecoder().decode(output.source)))
      .join('\n')

    for (const contract of previewUtilityContracts) {
      const ruleStart = `.${contract.className}{`
      const ruleOffset = css.indexOf(ruleStart)
      const ruleEnd = ruleOffset < 0 ? -1 : css.indexOf('}', ruleOffset)
      const rule = ruleOffset < 0 || ruleEnd < 0 ? '' : css.slice(ruleOffset, ruleEnd + 1)

      expect(rule, `${contract.className} is required by ProjectSchemaRenderer`).toContain(contract.declaration)
    }
  }, 15_000)
})
