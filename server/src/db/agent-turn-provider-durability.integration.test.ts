import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.js'
import { createPgRepository } from './repository.js'

const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = runtimeDatabaseUrl && adminDatabaseUrl ? describe : describe.skip
const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null
const runtime = runtimeDatabaseUrl ? new Pool({ connectionString: runtimeDatabaseUrl }) : null
const repository = runtimeDatabaseUrl ? createPgRepository({ DATABASE_URL: runtimeDatabaseUrl } as AppEnv) : null

async function asActor<T>(actorId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!runtime) throw new Error('Agent turn durability runtime database is unavailable')
  const client = await runtime.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.actor_id', $1, true)`, [actorId])
    const result = await run(client)
    await client.query('rollback')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function seedProject() {
  if (!admin) throw new Error('Agent turn durability administrator database is unavailable')
  const actorId = randomUUID()
  const otherActorId = randomUUID()
  const spaceId = randomUUID()
  const projectId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1), ($2)', [actorId, otherActorId])
  await admin.query(
    `insert into app.spaces (id, kind, name, personal_owner_id, created_by)
     values ($1, 'personal', 'Turn durability integration', $2, $2)`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.space_members (space_id, user_id, role)
     values ($1, $2, 'owner'), ($1, $3, 'editor')`,
    [spaceId, actorId, otherActorId],
  )
  await admin.query(
    `insert into app.projects (id, owner_id, space_id, name, draft_schema)
     values ($1, $2, $3, 'Turn durability integration', '{}'::jsonb)`,
    [projectId, actorId, spaceId],
  )
  await admin.query(
    `insert into app.project_members (project_id, user_id, role, created_by)
     values ($1, $2, 'owner', $2), ($1, $3, 'editor', $2)
     on conflict (project_id, user_id) do update set role = excluded.role`,
    [projectId, actorId, otherActorId],
  )
  return { actorId, otherActorId, projectId }
}

async function seedDispatch(actorId: string, projectId: string) {
  if (!admin) throw new Error('Agent turn durability administrator database is unavailable')
  const result = await admin.query<{ id: string }>(
    `insert into app.agent_run_dispatches (
       actor_id, project_id, conversation_id, task_id, operation_id, turn_id, input_digest,
       input_snapshot, phase, frozen_provider, frozen_model, frozen_profile, frozen_config_digest,
       billing_scope, payer_id, task_limit_micros, project_limit_micros, warning_ratio,
       provider_idempotency
     ) values (
       $1, $2, $3, $4, $5, $6, $7, '{"kind":"integration"}'::jsonb, 'planning',
       'openai-compatible', 'integration-model', 'platform:default', $8,
       'project', $2, 10000, 100000, 0.8, 'stable'
     ) returning id`,
    [
      actorId,
      projectId,
      `conversation-${randomUUID()}`,
      `task-${randomUUID()}`,
      `operation-${randomUUID()}`,
      `turn-${randomUUID()}`,
      'a'.repeat(64),
      'b'.repeat(64),
    ],
  )
  return result.rows[0]!.id
}

async function seedReservedCost(actorId: string, projectId: string, dispatchId: string, reservedMicros = 500) {
  if (!admin) throw new Error('Agent turn durability administrator database is unavailable')
  await admin.query(
    `insert into app.agent_run_costs (
       actor_id, project_id, task_id, turn_id, input_digest, state, reserved_micros,
       billing_scope, payer_id, reservation_expires_at
     )
     select actor_id, project_id, task_id, turn_id, input_digest, 'reserved', $2,
       'project', project_id, now() + interval '10 minutes'
     from app.agent_run_dispatches where id = $1`,
    [dispatchId, reservedMicros],
  )
  const dispatch = await admin.query<{ task_id: string; turn_id: string }>(
    'select task_id, turn_id from app.agent_run_dispatches where id = $1',
    [dispatchId],
  )
  return dispatch.rows[0]!
}

async function leaseDispatch(dispatchId: string, generation: number, workerId: string, leaseUntil: Date) {
  if (!admin) throw new Error('Agent turn durability administrator database is unavailable')
  await admin.query(
    `update app.agent_run_dispatches
     set state = 'running', desired_state = 'running', generation = $2, lease_owner = $3,
         lease_until = $4, heartbeat_at = now(), updated_at = now()
     where id = $1`,
    [dispatchId, generation, workerId, leaseUntil],
  )
  return { dispatchId, workerId, leaseGeneration: generation }
}

describeWithDatabase('Agent turn/provider durability PostgreSQL integration', () => {
  afterAll(async () => {
    await runtime?.end()
    await admin?.end()
  })

  it('enforces monotonic provider-attempt transitions and terminal immutability', async () => {
    if (!admin) throw new Error('Agent turn durability administrator database is unavailable')
    const fixture = await seedProject()
    try {
      const dispatchId = await seedDispatch(fixture.actorId, fixture.projectId)
      const attempt = await admin.query<{ id: string }>(
        `insert into app.agent_provider_attempts (
           actor_id, project_id, dispatch_id, dispatch_generation, dispatch_worker_id, attempt_no, provider_request_key,
           request_body_digest, reservation_delta_micros
         ) values ($1, $2, $3, 0, 'integration-worker', 1, $4, $5, 500) returning id`,
        [fixture.actorId, fixture.projectId, dispatchId, `request-${randomUUID()}`, 'c'.repeat(64)],
      )
      const attemptId = attempt.rows[0]!.id

      await expect(
        admin.query(
          `update app.agent_provider_attempts
           set state = 'started', started_at = now(), updated_at = now()
           where id = $1`,
          [attemptId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 })
      await expect(
        admin.query(
          `update app.agent_provider_attempts
           set state = 'succeeded', cost_accuracy = 'actual', amount_micros = 320,
               minimum_micros = 320, maximum_micros = 320, prompt_tokens = 10,
               completion_tokens = 4, upstream_request_id = 'upstream-integration',
               completed_at = now(), updated_at = now()
           where id = $1`,
          [attemptId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 })
      await expect(
        admin.query(`update app.agent_provider_attempts set error_code = 'tampered' where id = $1`, [attemptId]),
      ).rejects.toThrow(/terminal agent provider attempts are immutable/i)
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [fixture.actorId, fixture.otherActorId])
    }
  })

  it('keeps attempt rows private to their actor even when another actor can edit the project', async () => {
    if (!admin) throw new Error('Agent turn durability administrator database is unavailable')
    const fixture = await seedProject()
    try {
      const dispatchId = await seedDispatch(fixture.actorId, fixture.projectId)
      await admin.query(
        `insert into app.agent_provider_attempts (
           actor_id, project_id, dispatch_id, dispatch_generation, dispatch_worker_id, attempt_no, request_body_digest
         ) values ($1, $2, $3, 0, 'integration-worker', 1, $4)`,
        [fixture.actorId, fixture.projectId, dispatchId, 'd'.repeat(64)],
      )

      const ownRows = await asActor(fixture.actorId, client =>
        client.query('select id from app.agent_provider_attempts where dispatch_id = $1', [dispatchId]),
      )
      const otherRows = await asActor(fixture.otherActorId, client =>
        client.query('select id from app.agent_provider_attempts where dispatch_id = $1', [dispatchId]),
      )
      expect(ownRows.rowCount).toBe(1)
      expect(otherRows.rowCount).toBe(0)
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [fixture.actorId, fixture.otherActorId])
    }
  })

  it('accepts the migrated settled cost representation and rejects the removed legacy lifecycle', async () => {
    if (!admin) throw new Error('Agent turn durability administrator database is unavailable')
    const fixture = await seedProject()
    const baseValues = [
      fixture.actorId,
      fixture.projectId,
      `task-${randomUUID()}`,
      `turn-${randomUUID()}`,
      'e'.repeat(64),
      new Date(Date.now() + 600_000),
    ]
    try {
      await expect(
        admin.query(
          `insert into app.agent_run_costs (
             actor_id, project_id, task_id, turn_id, input_digest, state, accuracy,
             reserved_micros, settled_micros, billing_scope, payer_id, reservation_expires_at
           ) values ($1, $2, $3, $4, $5, 'settled', 'billing_indeterminate', 500, 500,
             'project', $2, $6)`,
          baseValues,
        ),
      ).resolves.toMatchObject({ rowCount: 1 })
      await expect(
        admin.query(
          `insert into app.agent_run_costs (
             actor_id, project_id, task_id, turn_id, input_digest, state, accuracy,
             reserved_micros, settled_micros, billing_scope, payer_id, reservation_expires_at
           ) values ($1, $2, $3 || '-legacy', $4 || '-legacy', $5, 'billing_indeterminate', null,
             500, 500, 'project', $2, $6)`,
          baseValues,
        ),
      ).rejects.toThrow(/agent_run_costs_(?:state|accuracy_lifecycle)_check/i)
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [fixture.actorId, fixture.otherActorId])
    }
  })

  it('enforces all-or-none model input metadata and the 4 MiB byte limit', async () => {
    if (!admin) throw new Error('Agent turn durability administrator database is unavailable')
    const fixture = await seedProject()
    const validBytes = Buffer.alloc(4 * 1024 * 1024, 1)
    const tooLargeBytes = Buffer.alloc(4 * 1024 * 1024 + 1, 1)
    const insertAsset = (suffix: string, bytes: Buffer, size: number, sha256: string | null) =>
      admin.query<{ id: string }>(
        `insert into app.agent_assets (
           actor_id, project_id, idempotency_key, original_name, content_type, size, status,
           storage_path, model_input_status, model_input_bytes, model_input_content_type,
           model_input_sha256, model_input_size
         ) values ($1, $2, $3, 'input.png', 'image/png', $4, 'ready', $5, 'ready', $6,
           'image/png', $7, $8) returning id`,
        [
          fixture.actorId,
          fixture.projectId,
          `asset-${suffix}-${randomUUID()}`,
          size,
          `${fixture.actorId}/${fixture.projectId}/${suffix}-${randomUUID()}.png`,
          bytes,
          sha256,
          size,
        ],
      )
    try {
      const valid = await insertAsset('valid', validBytes, validBytes.byteLength, 'f'.repeat(64))
      expect(valid).toMatchObject({ rowCount: 1 })
      if (!repository) throw new Error('Agent turn durability repository is unavailable')
      const publicAsset = await repository.getAgentAsset!(fixture.actorId, fixture.projectId, valid.rows[0]!.id)
      expect(publicAsset).not.toHaveProperty('modelInputBytes')
      expect(publicAsset).not.toHaveProperty('modelInputSha256')
      const publicList = await repository.listAgentAssets!(fixture.actorId, fixture.projectId)
      expect(publicList.find(asset => asset.id === valid.rows[0]!.id)).not.toHaveProperty('modelInputBytes')
      await expect(insertAsset('partial', validBytes, validBytes.byteLength, null)).rejects.toThrow(
        /agent_assets_model_input_all_or_none_check/i,
      )
      await expect(insertAsset('oversize', tooLargeBytes, tooLargeBytes.byteLength, '0'.repeat(64))).rejects.toThrow(
        /agent_assets_model_input_all_or_none_check/i,
      )
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [fixture.actorId, fixture.otherActorId])
    }
  })

  it('keeps definite-failure retries non-cumulative and fences a started call after generation reclaim', async () => {
    if (!admin || !repository) throw new Error('Agent turn durability database is unavailable')
    const fixture = await seedProject()
    try {
      const dispatchId = await seedDispatch(fixture.actorId, fixture.projectId)
      const binding = await seedReservedCost(fixture.actorId, fixture.projectId, dispatchId)
      const requestBodyDigest = '1'.repeat(64)
      const providerRequestKey = `provider-${randomUUID()}`
      const prepare = (attempt: { dispatchId: string; workerId: string; leaseGeneration: number }, now: Date) =>
        repository.prepareAgentProviderAttempt!(fixture.actorId, attempt, {
          projectId: fixture.projectId,
          taskId: binding.task_id,
          turnId: binding.turn_id,
          providerRequestKey,
          requestBodyDigest,
          idempotencyMode: 'stable',
          reservedMicros: 500,
          now,
        })
      const failDefinite = async (
        attempt: { dispatchId: string; workerId: string; leaseGeneration: number },
        attemptId: string,
        now: Date,
      ) =>
        repository.completeAgentProviderAttempt!(fixture.actorId, attemptId, attempt, {
          state: 'failed_definite',
          providerAttempt: {
            providerRequestKey,
            requestBodyDigest,
            idempotencyMode: 'stable',
            idempotencyHeaderSent: true,
            reason: 'definite_failure',
          },
          now,
        })

      const firstNow = new Date()
      const firstLease = await leaseDispatch(dispatchId, 1, 'worker-one', new Date(firstNow.getTime() + 60_000))
      const first = await prepare(firstLease, firstNow)
      expect(first).toMatchObject({ state: 'prepared' })
      if (typeof first === 'string') throw new Error(`Unexpected first prepare result: ${first}`)
      await expect(failDefinite(firstLease, first.id, firstNow)).resolves.toMatchObject({ cost: { state: 'released' } })

      const secondNow = new Date(firstNow.getTime() + 1_000)
      const secondLease = await leaseDispatch(dispatchId, 2, 'worker-two', new Date(secondNow.getTime() + 60_000))
      const second = await prepare(secondLease, secondNow)
      expect(second).toMatchObject({ state: 'prepared' })
      if (typeof second === 'string') throw new Error(`Unexpected second prepare result: ${second}`)
      await expect(failDefinite(secondLease, second.id, secondNow)).resolves.toMatchObject({
        cost: { state: 'released' },
      })

      const thirdNow = new Date(secondNow.getTime() + 1_000)
      const thirdLease = await leaseDispatch(dispatchId, 3, 'worker-three', new Date(thirdNow.getTime() + 60_000))
      const third = await prepare(thirdLease, thirdNow)
      expect(third).toMatchObject({ state: 'prepared' })
      if (typeof third === 'string') throw new Error(`Unexpected third prepare result: ${third}`)
      await expect(
        repository.markAgentProviderAttemptStarted!(fixture.actorId, third.id, thirdLease, thirdNow),
      ).resolves.toMatchObject({ state: 'started' })

      const fourthNow = new Date(thirdNow.getTime() + 1_000)
      const fourthLease = await leaseDispatch(dispatchId, 4, 'worker-four', new Date(fourthNow.getTime() + 60_000))
      await expect(prepare(fourthLease, fourthNow)).resolves.toBe('outcome_unknown')

      const attempts = await admin.query<{
        attempt_no: number
        reservation_delta_micros: number
        state: string
      }>(
        `select attempt_no, reservation_delta_micros, state
         from app.agent_provider_attempts where dispatch_id = $1 order by attempt_no`,
        [dispatchId],
      )
      expect(attempts.rows).toEqual([
        { attempt_no: 1, reservation_delta_micros: 0, state: 'failed_definite' },
        { attempt_no: 2, reservation_delta_micros: 500, state: 'failed_definite' },
        { attempt_no: 3, reservation_delta_micros: 500, state: 'outcome_unknown' },
      ])
      const cost = await admin.query<{ state: string; accuracy: string; settled_micros: number }>(
        'select state, accuracy, settled_micros from app.agent_run_costs where turn_id = $1',
        [binding.turn_id],
      )
      expect(cost.rows[0]).toEqual({ state: 'settled', accuracy: 'billing_indeterminate', settled_micros: 500 })
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [fixture.actorId, fixture.otherActorId])
    }
  })

  it('releases an expired prepared attempt because no provider call started', async () => {
    if (!admin || !repository) throw new Error('Agent turn durability database is unavailable')
    const fixture = await seedProject()
    try {
      const dispatchId = await seedDispatch(fixture.actorId, fixture.projectId)
      const binding = await seedReservedCost(fixture.actorId, fixture.projectId, dispatchId)
      const preparedAt = new Date()
      const lease = await leaseDispatch(dispatchId, 1, 'prepared-worker', new Date(preparedAt.getTime() + 1_000))
      const prepared = await repository.prepareAgentProviderAttempt!(fixture.actorId, lease, {
        projectId: fixture.projectId,
        taskId: binding.task_id,
        turnId: binding.turn_id,
        providerRequestKey: `provider-${randomUUID()}`,
        requestBodyDigest: '2'.repeat(64),
        idempotencyMode: 'stable',
        reservedMicros: 500,
        now: preparedAt,
      })
      if (typeof prepared === 'string') throw new Error(`Unexpected prepare result: ${prepared}`)
      await expect(
        repository.reconcileAgentProviderAttempt!(fixture.actorId, lease, new Date(preparedAt.getTime() + 2_000)),
      ).resolves.toMatchObject({ state: 'failed_definite' })
      const cost = await admin.query<{ state: string; accuracy: string | null; settled_micros: number }>(
        'select state, accuracy, settled_micros from app.agent_run_costs where turn_id = $1',
        [binding.turn_id],
      )
      expect(cost.rows[0]).toEqual({ state: 'released', accuracy: null, settled_micros: 0 })
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [fixture.actorId, fixture.otherActorId])
    }
  })

  it('binds the legacy initial dispatch once and stores later turns for the same task independently', async () => {
    if (!admin || !repository) throw new Error('Agent turn durability database is unavailable')
    const fixture = await seedProject()
    try {
      const conversationId = `conversation-${randomUUID()}`
      const taskId = `task-${randomUUID()}`
      const initialOperationId = `operation-${randomUUID()}`
      const initial = await repository.enqueueAgentRunDispatch!(fixture.actorId, {
        projectId: fixture.projectId,
        conversationId,
        taskId,
        operationId: initialOperationId,
        now: new Date(),
      })
      expect(initial).not.toBeNull()
      await admin.query("update app.agent_run_dispatches set kind = 'initial' where id = $1", [initial!.id])

      const enqueue = (turnId: string, operationId: string, prompt: string, now: Date) =>
        repository.enqueueAgentTurn!(fixture.actorId, {
          projectId: fixture.projectId,
          conversationId,
          taskId,
          turnId,
          operationId,
          inputDigest: Buffer.from(prompt).toString('hex').padEnd(64, '0').slice(0, 64),
          prompt,
          attachmentIds: [],
          projectContext: [],
          provider: 'openai-compatible',
          model: 'integration-model',
          profileId: 'platform:default',
          endpoint: 'http://provider.invalid/v1',
          billingScope: 'project',
          payerId: fixture.projectId,
          taskLimitMicros: 10_000,
          projectMonthLimitMicros: 100_000,
          projectDraftVersion: 1,
          reservedMicros: 500,
          maximumRateMicrosPerToken: 1,
          providerInputSnapshot: {
            systemPrompt: 'system',
            userText: JSON.stringify({ requirement: prompt }),
            trace: {
              promptBundleId: 'integration',
              promptBundleVersion: '1.0.0',
              promptBundleHash: 'integration-hash',
              skills: [],
            },
            images: [],
          },
          idempotencyMode: 'stable',
          providerRequestKey: `request-${turnId}`,
          now,
          reservationExpiresAt: new Date(now.getTime() + 600_000),
        })

      const first = await enqueue(`turn-${randomUUID()}`, initialOperationId, 'first prompt', new Date())
      expect(first).toMatchObject({ dispatch: { id: initial!.id, kind: 'initial' }, cost: { state: 'reserved' } })
      const second = await enqueue(
        `turn-${randomUUID()}`,
        `operation-${randomUUID()}`,
        'second prompt',
        new Date(Date.now() + 1_000),
      )
      expect(second).toMatchObject({ dispatch: { kind: 'run' }, cost: { state: 'reserved' } })
      if (typeof first === 'string' || typeof second === 'string' || !first || !second) {
        throw new Error('Unexpected durable turn enqueue result')
      }
      expect(second.dispatch.id).not.toBe(first.dispatch.id)

      const rows = await admin.query<{ dispatch_count: number; cost_count: number }>(
        `select
           (select count(*)::int from app.agent_run_dispatches where actor_id = $1 and project_id = $2 and task_id = $3) as dispatch_count,
           (select count(*)::int from app.agent_run_costs where actor_id = $1 and project_id = $2 and task_id = $3) as cost_count`,
        [fixture.actorId, fixture.projectId, taskId],
      )
      expect(rows.rows[0]).toEqual({ dispatch_count: 2, cost_count: 2 })
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [fixture.actorId, fixture.otherActorId])
    }
  })

  it('persists identical model bytes idempotently without advancing an upload-paused dispatch', async () => {
    if (!admin || !repository) throw new Error('Agent turn durability database is unavailable')
    const fixture = await seedProject()
    try {
      const conversationId = `conversation-${randomUUID()}`
      const dispatchId = await seedDispatch(fixture.actorId, fixture.projectId)
      await admin.query(
        `update app.agent_run_dispatches
         set conversation_id = $2, state = 'paused', desired_state = 'paused', waiting_reason = 'upload'
         where id = $1`,
        [dispatchId, conversationId],
      )
      const asset = await admin.query<{ id: string }>(
        `insert into app.agent_assets (
           actor_id, project_id, conversation_id, idempotency_key, original_name,
           content_type, size, status, storage_path
         ) values ($1, $2, $3, $4, 'input.png', 'image/png', 4, 'ready', $5)
         returning id`,
        [
          fixture.actorId,
          fixture.projectId,
          conversationId,
          `asset-${randomUUID()}`,
          `${fixture.actorId}/${fixture.projectId}/${randomUUID()}.png`,
        ],
      )
      const assetId = asset.rows[0]!.id
      const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
      const modelInput = {
        record: { contentType: 'image/png' as const, size: bytes.byteLength, sha256: '3'.repeat(64) },
        bytes,
      }
      await expect(
        Promise.all([
          repository.persistAgentAssetModelInput!(fixture.actorId, fixture.projectId, assetId, modelInput),
          repository.persistAgentAssetModelInput!(fixture.actorId, fixture.projectId, assetId, modelInput),
        ]),
      ).resolves.toEqual([true, true])
      await expect(repository.getAgentAssetModelInput!(fixture.actorId, fixture.projectId, assetId)).resolves.toEqual({
        record: modelInput.record,
        bytes,
      })

      const dispatch = await admin.query<{ state: string; desired_state: string; waiting_reason: string | null }>(
        'select state, desired_state, waiting_reason from app.agent_run_dispatches where id = $1',
        [dispatchId],
      )
      expect(dispatch.rows[0]).toEqual({ state: 'paused', desired_state: 'paused', waiting_reason: 'upload' })
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [fixture.actorId, fixture.otherActorId])
    }
  })
})
