import { afterEach, describe, expect, it, vi } from 'vitest'

import { DraftSync } from './draft-sync'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DraftSync', () => {
  it('debounces repeated dirty marks into one autosave', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue({ draftVersion: 2 })
    const sync = new DraftSync({
      initialVersion: 1,
      debounceMs: 100,
      exportSchema: () => ({ title: 'latest' }),
      save,
    })

    sync.markDirty()
    await vi.advanceTimersByTimeAsync(60)
    sync.markDirty()
    await vi.advanceTimersByTimeAsync(99)

    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith({ title: 'latest' }, 1)
  })

  it('coalesces edits made during a save into a sequential follow-up save', async () => {
    const firstSave = deferred<{ draftVersion: number }>()
    const secondSave = deferred<{ draftVersion: number }>()
    let schemaRevision = 1
    let activeSaves = 0
    let peakActiveSaves = 0
    const save = vi
      .fn()
      .mockImplementationOnce(async () => {
        activeSaves += 1
        peakActiveSaves = Math.max(peakActiveSaves, activeSaves)
        const result = await firstSave.promise
        activeSaves -= 1
        return result
      })
      .mockImplementationOnce(async () => {
        activeSaves += 1
        peakActiveSaves = Math.max(peakActiveSaves, activeSaves)
        const result = await secondSave.promise
        activeSaves -= 1
        return result
      })
    const sync = new DraftSync({
      initialVersion: 7,
      autoSave: false,
      exportSchema: () => ({ revision: schemaRevision }),
      save,
    })

    sync.markDirty()
    const flush = sync.flush()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

    schemaRevision = 2
    sync.markDirty()
    firstSave.resolve({ draftVersion: 8 })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(peakActiveSaves).toBe(1)
    expect(save).toHaveBeenNthCalledWith(1, { revision: 1 }, 7)
    expect(save).toHaveBeenNthCalledWith(2, { revision: 2 }, 8)

    secondSave.resolve({ draftVersion: 9 })
    await flush
  })

  it('advances the expected CAS version after each successful save', async () => {
    const firstSavedAt = '2026-07-30T04:05:06.000Z'
    const secondSavedAt = '2026-07-30T04:06:07.000Z'
    const save = vi
      .fn()
      .mockResolvedValueOnce({ draftVersion: 12, savedAt: firstSavedAt })
      .mockResolvedValueOnce({ draftVersion: 15, savedAt: secondSavedAt })
    const sync = new DraftSync({
      initialVersion: 10,
      autoSave: false,
      exportSchema: () => ({ stable: true }),
      save,
    })

    sync.markDirty()
    await sync.flush()
    sync.markDirty()
    await sync.flush()

    expect(save).toHaveBeenNthCalledWith(1, { stable: true }, 10)
    expect(save).toHaveBeenNthCalledWith(2, { stable: true }, 12)
    expect(sync.getSnapshot()).toMatchObject({
      status: 'saved',
      version: 15,
      savedAt: secondSavedAt,
    })
  })

  it('keeps the last server-confirmed save time while a later save fails', async () => {
    const savedAt = '2026-07-30T04:05:06.000Z'
    const save = vi
      .fn()
      .mockResolvedValueOnce({ draftVersion: 2, savedAt })
      .mockRejectedValueOnce(new Error('network unavailable'))
    const sync = new DraftSync({
      initialVersion: 1,
      initialSavedAt: null,
      autoSave: false,
      exportSchema: () => ({ stable: true }),
      save,
    })

    sync.markDirty()
    await sync.flush()
    expect(sync.getSnapshot()).toMatchObject({ status: 'saved', version: 2, savedAt })

    sync.markDirty()
    await sync.flush()
    expect(sync.getSnapshot()).toMatchObject({
      status: 'error',
      version: 2,
      savedAt,
    })
  })

  it('accepts a server-restored draft as the new clean baseline', () => {
    const sync = new DraftSync({
      initialVersion: 3,
      initialSavedAt: '2026-07-30T03:00:00.000Z',
      autoSave: false,
      exportSchema: () => ({ stable: true }),
      save: vi.fn(),
    })

    sync.markDirty()
    sync.acceptReloadedVersion(9, '2026-07-30T09:00:00.000Z')

    expect(sync.getSnapshot()).toEqual({
      status: 'saved',
      version: 9,
      savedAt: '2026-07-30T09:00:00.000Z',
      error: null,
    })
  })

  it('stops subsequent saves after a 409 conflict', async () => {
    const conflict = Object.assign(new Error('draft version conflict'), { status: 409 })
    const save = vi.fn().mockRejectedValue(conflict)
    const sync = new DraftSync({
      initialVersion: 4,
      autoSave: false,
      exportSchema: () => ({ title: 'conflicting draft' }),
      save,
    })

    sync.markDirty()
    await sync.flush()

    expect(sync.getSnapshot()).toMatchObject({
      status: 'conflict',
      version: 4,
      error: conflict,
    })

    sync.markDirty()
    await sync.flush()

    expect(save).toHaveBeenCalledOnce()
  })

  it('preserves the losing local schema until a two-instance CAS conflict is explicitly resolved', async () => {
    let serverVersion = 1
    let serverSchema = { title: 'initial' }
    const save = async (schema: { title: string }, expectedVersion: number) => {
      if (expectedVersion !== serverVersion) {
        throw Object.assign(new Error('draft version conflict'), { status: 409 })
      }
      serverVersion += 1
      serverSchema = schema
      return { draftVersion: serverVersion, savedAt: '2026-07-30T10:00:00.000Z' }
    }
    const first = new DraftSync({
      initialVersion: 1,
      autoSave: false,
      exportSchema: () => ({ title: 'first tab' }),
      save,
    })
    const second = new DraftSync({
      initialVersion: 1,
      autoSave: false,
      exportSchema: () => ({ title: 'second tab local work' }),
      save,
    })

    first.markDirty()
    await first.flush()
    second.markDirty()
    await second.flush()

    expect(serverSchema).toEqual({ title: 'first tab' })
    expect(second.getSnapshot().status).toBe('conflict')
    expect(second.getConflictSchema()).toEqual({ title: 'second tab local work' })

    second.acceptReloadedVersion(serverVersion, '2026-07-30T10:00:00.000Z')

    expect(second.getSnapshot().status).toBe('saved')
    expect(second.getConflictSchema()).toBeUndefined()
  })

  it('flushes a pending autosave before disposal', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue({ draftVersion: 2 })
    const sync = new DraftSync({
      initialVersion: 1,
      debounceMs: 900,
      exportSchema: () => ({ title: 'latest before navigation' }),
      save,
    })

    sync.markDirty()
    await sync.flushAndDispose()
    await vi.advanceTimersByTimeAsync(900)

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith({ title: 'latest before navigation' }, 1)
    expect(sync.getSnapshot()).toMatchObject({ status: 'saved', version: 2 })

    sync.markDirty()
    await sync.flush()
    expect(save).toHaveBeenCalledOnce()
  })

  it('freezes the closing schema while an earlier save is still in flight', async () => {
    const firstSave = deferred<{ draftVersion: number }>()
    let source = { project: 'A', revision: 1 }
    const save = vi
      .fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce({ draftVersion: 3 })
    const sync = new DraftSync({
      initialVersion: 1,
      autoSave: false,
      exportSchema: () => ({ ...source }),
      save,
    })

    sync.markDirty()
    const firstFlush = sync.flush()
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())

    source = { project: 'A', revision: 2 }
    sync.markDirty()
    const close = sync.flushAndDispose()
    source = { project: 'B', revision: 1 }
    firstSave.resolve({ draftVersion: 2 })

    await Promise.all([firstFlush, close])

    expect(save).toHaveBeenNthCalledWith(1, { project: 'A', revision: 1 }, 1)
    expect(save).toHaveBeenNthCalledWith(2, { project: 'A', revision: 2 }, 2)
  })
})
