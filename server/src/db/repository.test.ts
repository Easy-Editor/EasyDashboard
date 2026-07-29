import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env.js'

const transaction = vi.fn()

vi.mock('./client.js', () => ({
  createDatabase: () => ({
    db: { transaction },
    pool: { query: vi.fn() },
  }),
}))

const env = {} as AppEnv

function selectResult(result: unknown[], lockCalls: string[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn((lock: string) => {
      lockCalls.push(lock)
      return chain
    }),
    limit: vi.fn(async () => result),
    innerJoin: vi.fn(),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.innerJoin.mockReturnValue(chain)
  return chain
}

describe('publication serialization', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('locks the project row before rollback reads or updates the publication', async () => {
    const lockCalls: string[] = []
    const lock = selectResult([{ id: 'project' }], lockCalls)
    const missingRevision = selectResult([], lockCalls)
    const tx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(lock).mockReturnValueOnce(missingRevision),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await createPgRepository(env).rollback('actor', 'project', 'revision')

    expect(lockCalls).toEqual(['update'])
    expect(tx.select).toHaveBeenCalledTimes(2)
  })

  it('locks the project row before deleting a publication', async () => {
    const lockCalls: string[] = []
    const lock = selectResult([{ id: 'project' }], lockCalls)
    const returning = vi.fn(async () => [])
    const where = vi.fn(() => ({ returning }))
    const tx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue(lock),
      delete: vi.fn(() => ({ where })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await createPgRepository(env).unpublish('actor', 'project')

    expect(lockCalls).toEqual(['update'])
    expect(tx.delete).toHaveBeenCalledOnce()
  })
})
