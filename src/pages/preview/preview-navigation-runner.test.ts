import { describe, expect, it } from 'vitest'

import { createLatestPreviewNavigationRunner } from './preview-navigation-runner'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('latest preview navigation runner', () => {
  it('does not let an older page commit when its material load finishes last', async () => {
    const runner = createLatestPreviewNavigationRunner()
    const olderLoad = deferred()
    const latestLoad = deferred()
    const committedPages: string[] = []

    const olderRequest = runner.run({
      load: () => olderLoad.promise,
      commit: () => committedPages.push('older-page'),
    })
    const latestRequest = runner.run({
      load: () => latestLoad.promise,
      commit: () => committedPages.push('latest-page'),
    })

    latestLoad.resolve()
    await expect(latestRequest).resolves.toBe(true)
    olderLoad.resolve()

    await expect(olderRequest).resolves.toBe(false)
    expect(committedPages).toEqual(['latest-page'])
  })
})
