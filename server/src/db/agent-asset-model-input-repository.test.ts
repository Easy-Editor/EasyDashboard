import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repository = readFileSync(new URL('./repository.ts', import.meta.url), 'utf8')

describe('Agent asset model input repository boundary', () => {
  it('projects only public asset metadata from get/list paths', () => {
    const publicSelection = repository.slice(
      repository.indexOf('const agentAssetPublicSelection'),
      repository.indexOf('const MAX_THUMBNAIL_BYTES'),
    )
    expect(publicSelection).not.toContain('modelInputBytes')
    expect(publicSelection).not.toContain('modelInputSha256')

    const publicReads = repository.slice(
      repository.indexOf('async getAgentAsset(actorId'),
      repository.indexOf('async deleteAgentAsset(actorId'),
    )
    expect(publicReads).toContain('.select(agentAssetPublicSelection)')
  })

  it('scrubs persisted model bytes before attempting durable Storage cleanup', () => {
    const deletion = repository.slice(
      repository.indexOf('async deleteAgentAsset(actorId'),
      repository.indexOf('async reserveAgentRunCost(actorId'),
    )
    expect(deletion).toContain('modelInputStatus: null')
    expect(deletion).toContain('modelInputBytes: null')
    expect(deletion).toContain('modelInputContentType: null')
    expect(deletion).toContain('modelInputSha256: null')
    expect(deletion).toContain('modelInputSize: null')
    expect(deletion).toContain("storageCleanupStatus: 'pending'")
    expect(deletion.indexOf("storageCleanupStatus: 'pending'")).toBeLessThan(
      deletion.indexOf('agentAssetStorage(accessToken).remove'),
    )
  })
})
