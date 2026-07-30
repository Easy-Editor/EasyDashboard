import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env.js'
import type { Repository } from '../types.js'
import { projectPublications, projectReleases, projects } from './schema.js'

const transaction = vi.fn()
const poolQuery = vi.hoisted(() => vi.fn())
const storageInfo = vi.hoisted(() =>
  vi.fn(async () => ({ data: { size: 1024, contentType: 'image/webp' }, error: null })),
)
const storageRemove = vi.hoisted(() => vi.fn(async () => ({ data: [], error: null })))

vi.mock('./client.js', () => ({
  createDatabase: () => ({
    db: { transaction },
    pool: { query: poolQuery },
  }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        info: storageInfo,
        remove: storageRemove,
      }),
    },
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

describe('database readiness', () => {
  beforeEach(() => {
    poolQuery.mockReset()
  })

  it('checks the release and thumbnail artifact schema without reading rows', async () => {
    poolQuery.mockResolvedValue({ rows: [] })
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).ping()).resolves.toBeUndefined()

    expect(poolQuery).toHaveBeenCalledOnce()
    const query = poolQuery.mock.calls[0]?.[0] as string
    expect(query).toContain('from app.project_releases as releases')
    expect(query).toContain('cross join app.project_thumbnail_artifacts as thumbnail_artifacts')
    expect(query).toContain('releases.release_number')
    expect(query).toContain('thumbnail_artifacts.status')
    expect(query).toContain('limit 0')
  })

  it('propagates a missing migration error', async () => {
    const missingSchema = new Error('relation "app.project_releases" does not exist')
    poolQuery.mockRejectedValue(missingSchema)
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).ping()).rejects.toBe(missingSchema)
  })
})

describe('signed thumbnail upload expiry', () => {
  it('starts the cleanup deadline after delayed signing and keeps a safety margin', async () => {
    const requestStartedAt = Date.parse('2026-07-30T00:00:00.000Z')
    const signedAt = requestStartedAt + 10 * 60 * 1000
    const tokenExpiresAt = signedAt + 2 * 60 * 60 * 1000
    const payload = Buffer.from(JSON.stringify({ exp: tokenExpiresAt / 1000 })).toString('base64url')
    const token = `header.${payload}.signature`
    const { signedThumbnailUploadCleanupExpiry } = await import('./repository.js')

    const cleanupAt = signedThumbnailUploadCleanupExpiry(token, signedAt)

    expect(cleanupAt.getTime()).toBe(tokenExpiresAt + 60_000)
    expect(cleanupAt.getTime()).toBeGreaterThan(requestStartedAt + 2 * 60 * 60 * 1000)
  })

  it('falls back to two hours after signing when the token representation changes', async () => {
    const signedAt = Date.parse('2026-07-30T00:10:00.000Z')
    const { signedThumbnailUploadCleanupExpiry } = await import('./repository.js')

    expect(signedThumbnailUploadCleanupExpiry('opaque-token', signedAt).getTime()).toBe(
      signedAt + 2 * 60 * 60 * 1000 + 60_000,
    )
  })
})

describe('thumbnail requested version SQL', () => {
  it('casts the CASE parameter to integer for draft saves and revision restores', async () => {
    const { thumbnailRequestedVersionCase } = await import('./repository.js')

    const query = new PgDialect().sqlToQuery(thumbnailRequestedVersionCase(5))

    expect(query.sql).toContain('then cast($1 as integer)')
    expect(query.params).toEqual([5])
  })
})

describe('publication serialization', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('locks the project row before deactivating a publication', async () => {
    const lockCalls: string[] = []
    const lock = selectResult([{ id: 'project' }], lockCalls)
    const returning = vi.fn(async () => [])
    const where = vi.fn(() => ({ returning }))
    const tx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue(lock),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await createPgRepository(env).unpublish('actor', 'project')

    expect(lockCalls).toEqual(['update'])
    expect(tx.update).toHaveBeenCalledOnce()
  })
})

describe('release-to-draft restoration', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('backs up the current draft and restores immutable release content without changing the publication', async () => {
    const lockCalls: string[] = []
    const currentSchema = { componentsTree: [] as [] }
    const releaseSchema = {
      componentsTree: [
        {
          docId: 'page-release',
          $dashboard: { rect: { width: 2560, height: 1440 } },
        },
      ],
    }
    const projectLock = selectResult(
      [
        {
          id: 'project',
          draftVersion: 4,
          draftSchema: currentSchema,
          thumbnailMode: 'auto',
          thumbnailPath: null,
        },
      ],
      lockCalls,
    )
    const releaseLookup = selectResult([{ schema: releaseSchema }], [])
    const revisionNumber = {
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ value: 8 }]),
      })),
    }
    const restoredDetail = {
      id: 'project',
      draftVersion: 5,
      draftSchema: releaseSchema,
      publicationSlug: 'stable-dashboard',
      publishedRevisionId: 'published-revision',
      publishedAt: new Date('2026-07-30T01:00:00.000Z'),
      currentReleaseNumber: 2,
    }
    const detailLookup = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => [restoredDetail]),
    }
    detailLookup.from.mockReturnValue(detailLookup)
    detailLookup.leftJoin.mockReturnValue(detailLookup)
    detailLookup.where.mockReturnValue(detailLookup)

    let insertedRevision: Record<string, unknown> | undefined
    const insert = vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedRevision = values
        return {
          returning: vi.fn(async () => [{ id: 'pre-restore-revision', ...values }]),
        }
      }),
    }))
    let projectUpdate: Record<string, unknown> | undefined
    const update = vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        projectUpdate = values
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: 'project' }]),
          })),
        }
      }),
    }))
    const tx = {
      execute: vi.fn(),
      select: vi
        .fn()
        .mockReturnValueOnce(projectLock)
        .mockReturnValueOnce(releaseLookup)
        .mockReturnValueOnce(revisionNumber)
        .mockReturnValueOnce(detailLookup),
      insert,
      update,
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).restoreRelease('actor', 'project', 2, 4)).resolves.toEqual(restoredDetail)

    expect(lockCalls).toEqual(['update'])
    expect(insertedRevision).toMatchObject({
      projectId: 'project',
      schema: currentSchema,
      kind: 'pre_restore',
      sourceDraftVersion: 4,
      createdBy: 'actor',
    })
    expect(projectUpdate).toMatchObject({
      draftSchema: releaseSchema,
      draftVersion: 5,
      pageCount: 1,
      canvasWidth: 2560,
      canvasHeight: 1440,
      startPageId: 'page-release',
    })
    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(projects)
    expect(update).not.toHaveBeenCalledWith(projectPublications)
  })

  it('rejects a stale expected version before reading or mutating a release', async () => {
    const lockCalls: string[] = []
    const projectLock = selectResult([{ id: 'project', draftVersion: 5 }], lockCalls)
    const tx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue(projectLock),
      insert: vi.fn(),
      update: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).restoreRelease('actor', 'project', 2, 4)).resolves.toBe('conflict')

    expect(lockCalls).toEqual(['update'])
    expect(tx.select).toHaveBeenCalledOnce()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('does not create a backup when the requested release does not exist', async () => {
    const projectLock = selectResult([{ id: 'project', draftVersion: 4, draftSchema: { componentsTree: [] } }], [])
    const missingRelease = selectResult([], [])
    const tx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(projectLock).mockReturnValueOnce(missingRelease),
      insert: vi.fn(),
      update: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).restoreRelease('actor', 'project', 99, 4)).resolves.toBeNull()

    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('permanent project deletion', () => {
  beforeEach(() => {
    transaction.mockReset()
    storageRemove.mockClear()
  })

  it('requires the project to already be in trash', async () => {
    const lockCalls: string[] = []
    const activeProject = selectResult([{ id: 'project', deletedAt: null }], lockCalls)
    transaction.mockImplementation(async run => run({ execute: vi.fn(), select: vi.fn(() => activeProject) }))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).permanentlyDeleteProject('actor', 'token', 'project')).resolves.toBe(
      'conflict',
    )

    expect(lockCalls).toEqual(['update'])
    expect(storageRemove).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledOnce()
  })

  it('cleans due thumbnail objects before deleting the trashed project aggregate', async () => {
    const preflight = selectResult([{ id: 'project', deletedAt: new Date('2026-07-30T01:00:00.000Z') }], [])
    const reconcileProject = selectResult(
      [
        {
          id: 'project',
          deletedAt: new Date('2026-07-30T01:00:00.000Z'),
          currentPath: null,
          pendingPath: null,
        },
      ],
      [],
    )
    const cleanupCandidates = {
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ path: 'actor/project/4/thumbnail.webp' }]),
      })),
    }
    const reconcileTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(reconcileProject).mockReturnValueOnce(cleanupCandidates),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    }
    const markDeletedTx = {
      execute: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: 'artifact' }]),
          })),
        })),
      })),
    }
    const projectDelete = {
      where: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'project' }]),
      })),
    }
    const deleteTx = {
      execute: vi.fn(),
      delete: vi.fn(() => projectDelete),
    }
    transaction
      .mockImplementationOnce(async run => run({ execute: vi.fn(), select: vi.fn(() => preflight) }))
      .mockImplementationOnce(async run => run(reconcileTx))
      .mockImplementationOnce(async run => run(markDeletedTx))
      .mockImplementationOnce(async run => run(deleteTx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).permanentlyDeleteProject('actor', 'token', 'project')).resolves.toBe(true)

    expect(storageRemove).toHaveBeenCalledWith(['actor/project/4/thumbnail.webp'])
    expect(deleteTx.delete).toHaveBeenCalledWith(projects)
    expect(projectDelete.where).toHaveBeenCalledOnce()
  })

  it('does not delete a project that was restored and re-trashed while thumbnail cleanup was running', async () => {
    const originalDeletedAt = new Date('2026-07-30T01:00:00.000Z')
    const retrashDeletedAt = new Date('2026-07-30T01:05:00.000Z')
    const preflight = selectResult([{ id: 'project', deletedAt: originalDeletedAt }], [])
    const reconcileProject = selectResult(
      [{ id: 'project', deletedAt: originalDeletedAt, currentPath: null, pendingPath: null }],
      [],
    )
    const noCleanupCandidates = {
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    }
    const reconcileTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(reconcileProject).mockReturnValueOnce(noCleanupCandidates),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    }
    let deletePredicate: SQL | undefined
    const projectDelete = {
      where: vi.fn((predicate: SQL) => {
        deletePredicate = predicate
        return {
          returning: vi.fn(async () => []),
        }
      }),
    }
    const reTrashedProject = selectResult([{ id: 'project', deletedAt: retrashDeletedAt }], [])
    const deleteTx = {
      execute: vi.fn(),
      delete: vi.fn(() => projectDelete),
      select: vi.fn(() => reTrashedProject),
    }
    transaction
      .mockImplementationOnce(async run => run({ execute: vi.fn(), select: vi.fn(() => preflight) }))
      .mockImplementationOnce(async run => run(reconcileTx))
      .mockImplementationOnce(async run => run(deleteTx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).permanentlyDeleteProject('actor', 'token', 'project')).resolves.toBe(
      'conflict',
    )

    expect(deletePredicate).toBeDefined()
    const query = new PgDialect().sqlToQuery(deletePredicate as SQL)
    expect(query.sql).toContain('"projects"."deleted_at" = $')
    expect(query.params).toContain(originalDeletedAt.toISOString())
    expect(query.params).not.toContain(retrashDeletedAt.toISOString())
  })

  it('returns not found without attempting cleanup when the project is inaccessible', async () => {
    const missingProject = selectResult([], [])
    transaction.mockImplementation(async run => run({ execute: vi.fn(), select: vi.fn(() => missingProject) }))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).permanentlyDeleteProject('actor', 'token', 'missing-project'),
    ).resolves.toBeNull()

    expect(storageRemove).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledOnce()
  })
})

describe('lightweight public publication probes', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it.each([
    ['stable URL', undefined, 1],
    ['version URL', 2, 2],
  ])('checks %s visibility without selecting the project schema', async (_label, releaseNumber, joinCount) => {
    let selection: Record<string, unknown> | undefined
    let predicate: SQL | undefined
    const chain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn((value: SQL) => {
        predicate = value
        return chain
      }),
      limit: vi.fn(async () => [{ projectId: 'project' }]),
    }
    chain.from.mockReturnValue(chain)
    chain.innerJoin.mockReturnValue(chain)
    const tx = {
      execute: vi.fn(),
      select: vi.fn((fields: Record<string, unknown>) => {
        selection = fields
        return chain
      }),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).isPublicProjectAvailable('dashboard', releaseNumber)).resolves.toBe(true)

    expect(Object.keys(selection ?? {})).toEqual(['projectId'])
    expect(chain.innerJoin).toHaveBeenCalledTimes(joinCount)
    expect(predicate).toBeDefined()
    const query = new PgDialect().sqlToQuery(predicate as SQL)
    expect(query.sql).toContain('"project_publications"."slug"')
    expect(query.sql).toContain('"project_publications"."is_published"')
    expect(query.sql).toContain('"projects"."deleted_at" is null')
    if (releaseNumber === undefined) {
      expect(query.sql).not.toContain('"project_releases"."release_number"')
    } else {
      expect(query.sql).toContain('"project_releases"."release_number"')
    }
  })

  it('reports an unavailable publication without falling back to a full public-project read', async () => {
    const chain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => []),
    }
    chain.from.mockReturnValue(chain)
    chain.innerJoin.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => chain),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).isPublicProjectAvailable('dashboard')).resolves.toBe(false)
  })
})

describe('thumbnail attempt compare-and-set', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it.each([
    ['an older overlapping attempt', 'actor/project/4/old-attempt.webp'],
    ['a failure callback after complete made the project ready', 'actor/project/4/completed-attempt.webp'],
  ])('rejects %s unless the exact path is still rendering', async (_scenario, path) => {
    let updatePredicate: SQL | undefined
    const returning = vi.fn(async () => [])
    const where = vi.fn((predicate: SQL) => {
      updatePredicate = predicate
      return { returning }
    })
    const existing = selectResult([{ id: 'project' }], [])
    const tx = {
      execute: vi.fn(),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
      select: vi.fn().mockReturnValue(existing),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).failThumbnailUpload('actor', 'access-token', 'project', {
        draftVersion: 4,
        path,
        errorCode: 'thumbnail-upload-failed',
      }),
    ).resolves.toBe('conflict')

    expect(updatePredicate).toBeDefined()
    const query = new PgDialect().sqlToQuery(updatePredicate as SQL)
    expect(query.sql).toContain('"project_thumbnail_artifacts"."path" = $')
    expect(query.sql).toContain('"project_thumbnail_artifacts"."status" = $')
    expect(query.sql).toContain('"project_thumbnail_artifacts"."draft_version" = $')
    expect(query.params).toEqual(expect.arrayContaining(['project', path, 'pending', 4]))
  })
})

describe('thumbnail transaction rollback', () => {
  beforeEach(() => {
    transaction.mockReset()
    storageInfo.mockClear()
  })

  function updateResult(rows: unknown[] | undefined) {
    const returning = vi.fn(async () => rows ?? [])
    const whereResult = rows === undefined ? Promise.resolve(undefined) : { returning }
    const set = vi.fn((_values: Record<string, unknown>) => ({
      where: vi.fn(() => whereResult),
    }))
    return {
      set,
    }
  }

  it('rolls back a prepared ledger artifact when the project CAS loses after insertion', async () => {
    const projectLock = selectResult([{ id: 'project', draftVersion: 4 }], [])
    const reconcileProject = selectResult(
      [{ id: 'project', deletedAt: null, currentPath: null, pendingPath: null }],
      [],
    )
    const cleanupCandidates = {
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    }
    const reconcileTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(reconcileProject).mockReturnValueOnce(cleanupCandidates),
      update: vi.fn(() => updateResult(undefined)),
    }
    let rolledBack = false
    const supersededArtifactUpdate = updateResult(undefined)
    const createTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue(projectLock),
      update: vi.fn().mockReturnValueOnce(supersededArtifactUpdate).mockReturnValueOnce(updateResult([])),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    }
    transaction
      .mockImplementationOnce(async run => run(reconcileTx))
      .mockImplementationOnce(async run => {
        try {
          return await run(createTx)
        } catch (error) {
          rolledBack = true
          throw error
        }
      })
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).createThumbnailUpload('actor', 'token', 'project', {
        draftVersion: 4,
        mode: 'auto',
        source: 'renderer',
        contentType: 'image/webp',
        size: 1024,
      }),
    ).resolves.toBe('conflict')

    expect(rolledBack).toBe(true)
    expect(createTx.insert).toHaveBeenCalledOnce()
    const supersededValues = supersededArtifactUpdate.set.mock.calls[0]?.[0] as Record<string, unknown>
    const cleanupQuery = new PgDialect().sqlToQuery(supersededValues.nextCleanupAt as SQL)
    expect(cleanupQuery.sql).toContain('greatest(')
    expect(cleanupQuery.sql).toContain('"expires_at"')
  })

  it('rolls back current promotion and old-current cleanup when the project CAS loses', async () => {
    const pending = selectResult(
      [
        {
          draftVersion: 4,
          path: 'actor/project/4/new.webp',
          contentType: 'image/webp',
          size: 1024,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
      [],
    )
    const projectLock = selectResult(
      [{ id: 'project', draftVersion: 4, requestedVersion: 4, pendingPath: 'actor/project/4/new.webp' }],
      [],
    )
    let rolledBack = false
    const replacedArtifactUpdate = updateResult(undefined)
    const completeTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue(projectLock),
      update: vi
        .fn()
        .mockReturnValueOnce(updateResult([{ id: 'artifact' }]))
        .mockReturnValueOnce(replacedArtifactUpdate)
        .mockReturnValueOnce(updateResult([])),
    }
    transaction
      .mockImplementationOnce(async run =>
        run({
          execute: vi.fn(),
          select: vi.fn().mockReturnValue(pending),
        }),
      )
      .mockImplementationOnce(async run => {
        try {
          return await run(completeTx)
        } catch (error) {
          rolledBack = true
          throw error
        }
      })
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).completeThumbnailUpload('actor', 'token', 'project', {
        draftVersion: 4,
        path: 'actor/project/4/new.webp',
      }),
    ).resolves.toBe('conflict')

    expect(rolledBack).toBe(true)
    expect(completeTx.update).toHaveBeenCalledTimes(3)
    const replacedValues = replacedArtifactUpdate.set.mock.calls[0]?.[0] as Record<string, unknown>
    const cleanupQuery = new PgDialect().sqlToQuery(replacedValues.nextCleanupAt as SQL)
    expect(cleanupQuery.sql).toContain('greatest(')
    expect(cleanupQuery.sql).toContain('"expires_at"')
  })

  it('trashes publication and thumbnail references atomically, then reconciles without early cleanup', async () => {
    const projectTrashUpdate = updateResult([{ id: 'project' }])
    const artifactTrashUpdate = updateResult(undefined)
    const publicationTrashUpdate = updateResult(undefined)
    const trashTx = {
      execute: vi.fn(),
      update: vi
        .fn()
        .mockReturnValueOnce(projectTrashUpdate)
        .mockReturnValueOnce(artifactTrashUpdate)
        .mockReturnValueOnce(publicationTrashUpdate),
    }
    const deletedProject = selectResult(
      [{ id: 'project', deletedAt: new Date(), currentPath: null, pendingPath: null }],
      [],
    )
    const cleanupCandidates = {
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    }
    const reconcileTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(deletedProject).mockReturnValueOnce(cleanupCandidates),
      update: vi.fn(() => updateResult(undefined)),
    }
    transaction.mockImplementationOnce(async run => run(trashTx)).mockImplementationOnce(async run => run(reconcileTx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).trashProject('actor', 'token', 'project')).resolves.toBe(true)

    const projectValues = projectTrashUpdate.set.mock.calls[0]?.[0] as Record<string, unknown>
    expect(projectValues).toMatchObject({
      deletedAt: expect.any(Date),
      thumbnailPath: null,
      thumbnailUrl: null,
      thumbnailDraftVersion: null,
      thumbnailPendingPath: null,
    })
    const artifactValues = artifactTrashUpdate.set.mock.calls[0]?.[0] as Record<string, unknown>
    expect(artifactValues.status).toBe('cleanup_pending')
    const cleanupQuery = new PgDialect().sqlToQuery(artifactValues.nextCleanupAt as SQL)
    expect(cleanupQuery.sql).toContain('greatest(')
    expect(cleanupQuery.sql).toContain('"expires_at"')
  })
})

describe('immutable release metadata', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('selects publication time and release number only through the current published revision', async () => {
    let selection: Record<string, unknown> | undefined
    const joins: Array<{ table: unknown; predicate: SQL }> = []
    const chain = {
      from: vi.fn(),
      leftJoin: vi.fn((table: unknown, predicate: SQL) => {
        joins.push({ table, predicate })
        return chain
      }),
      where: vi.fn(),
      orderBy: vi.fn(async () => []),
    }
    chain.from.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    const tx = {
      execute: vi.fn(),
      select: vi.fn((fields: Record<string, unknown>) => {
        selection = fields
        return chain
      }),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).listProjects('actor')).resolves.toEqual([])

    expect(selection?.publishedAt).toBe(projectPublications.publishedAt)
    expect(selection?.currentReleaseNumber).toBe(projectReleases.releaseNumber)
    expect(joins).toHaveLength(2)
    expect(joins[0]?.table).toBe(projectPublications)
    expect(joins[1]?.table).toBe(projectReleases)
    const publicationJoin = new PgDialect().sqlToQuery(joins[0]?.predicate as SQL)
    const releaseJoin = new PgDialect().sqlToQuery(joins[1]?.predicate as SQL)
    expect(publicationJoin.sql).toContain('"project_publications"."is_published"')
    expect(releaseJoin.sql).toContain('"project_releases"."revision_id"')
    expect(releaseJoin.sql).toContain('"project_publications"."revision_id"')
  })

  function scalarSelect(result: unknown[]) {
    return {
      from: vi.fn(() => ({
        where: vi.fn(async () => result),
      })),
    }
  }

  function publishTransaction(
    project: {
      id: string
      ownerId: string
      name: string
      description: string | null
      draftVersion: number
      draftSchema: { componentsTree: [] }
    },
    releaseNumber: number,
    capturedReleaseValues: Array<Record<string, unknown>>,
  ) {
    const lockCalls: string[] = []
    const projectLock = selectResult([project], lockCalls)
    const existingPublication = selectResult(releaseNumber === 1 ? [] : [{ slug: 'stable-dashboard' }], lockCalls)
    const selects = [
      projectLock,
      scalarSelect([{ value: releaseNumber - 1 }]),
      scalarSelect([{ value: releaseNumber - 1 }]),
      existingPublication,
    ]
    let insertCall = 0
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selects.shift()),
      insert: vi.fn(() => {
        insertCall += 1
        if (insertCall === 1) {
          return {
            values: vi.fn(() => ({
              returning: vi.fn(async () => [
                {
                  id: `revision-${releaseNumber}`,
                  projectId: project.id,
                  revisionNumber: releaseNumber,
                  schema: project.draftSchema,
                },
              ]),
            })),
          }
        }
        if (insertCall === 2) {
          return {
            values: vi.fn((values: Record<string, unknown>) => {
              capturedReleaseValues.push(values)
              return {
                returning: vi.fn(async () => [
                  {
                    ...values,
                    id: `release-${releaseNumber}`,
                    publishedAt: new Date(`2026-07-30T0${releaseNumber}:00:00.000Z`),
                  },
                ]),
              }
            }),
          }
        }
        return {
          values: vi.fn(() => ({
            onConflictDoUpdate: vi.fn(() => ({
              returning: vi.fn(async () => [
                {
                  slug: 'stable-dashboard',
                  publishedAt: new Date(`2026-07-30T0${releaseNumber}:00:00.000Z`),
                },
              ]),
            })),
          })),
        }
      }),
    }
    return tx
  }

  it('captures renamed project metadata only in the next release', async () => {
    const capturedReleaseValues: Array<Record<string, unknown>> = []
    const firstProject = {
      id: 'project',
      ownerId: 'actor',
      name: '发布时名称',
      description: '发布时描述',
      draftVersion: 1,
      draftSchema: { componentsTree: [] as [] },
    }
    const renamedProject = {
      ...firstProject,
      name: '改名后的名称',
      description: '改名后的描述',
      draftVersion: 2,
    }
    transaction
      .mockImplementationOnce(async run => run(publishTransaction(firstProject, 1, capturedReleaseValues)))
      .mockImplementationOnce(async run => run(publishTransaction(renamedProject, 2, capturedReleaseValues)))
    const { createPgRepository } = await import('./repository.js')
    const repository = createPgRepository(env)

    await repository.publish('actor', 'project', { expectedVersion: 1 })
    await repository.publish('actor', 'project', { expectedVersion: 2 })

    expect(capturedReleaseValues).toMatchObject([
      { releaseNumber: 1, name: '发布时名称', description: '发布时描述' },
      { releaseNumber: 2, name: '改名后的名称', description: '改名后的描述' },
    ])
  })

  it.each([
    ['stable URL', (repository: Repository) => repository.getPublicProject('dashboard')],
    ['version URL', (repository: Repository) => repository.getPublicProjectVersion('dashboard', 1)],
  ])('reads %s name and description from the immutable release snapshot', async (_label, readPublicProject) => {
    let selection: Record<string, unknown> | undefined
    const row = {
      slug: 'dashboard',
      projectId: 'project',
      name: '发布时名称',
      description: '发布时描述',
      revisionId: 'revision-1',
      revisionNumber: 1,
      releaseNumber: 1,
      schema: { componentsTree: [] },
      publishedAt: new Date('2026-07-30T01:00:00.000Z'),
    }
    const chain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => [row]),
    }
    chain.from.mockReturnValue(chain)
    chain.innerJoin.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    const tx = {
      execute: vi.fn(),
      select: vi.fn((fields: Record<string, unknown>) => {
        selection = fields
        return chain
      }),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(readPublicProject(createPgRepository(env))).resolves.toMatchObject({
      name: '发布时名称',
      description: '发布时描述',
    })
    expect(selection?.name).toBe(projectReleases.name)
    expect(selection?.description).toBe(projectReleases.description)
  })
})
