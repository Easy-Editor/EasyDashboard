import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  AGENT_USER_PREFERENCE_CATEGORIES,
  type AgentUserPreferenceMemory,
  isAgentUserPreferenceContentSafe,
  readAgentUserPreferenceMemory,
} from '../agent/agent-user-preferences.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'

const preferenceInputSchema = z
  .object({
    id: z.uuid().optional(),
    category: z.enum(AGENT_USER_PREFERENCE_CATEGORIES),
    content: z.string().trim().min(1).max(500),
    source: z.enum(['explicit', 'confirmed_repetition']),
  })
  .strict()

const updateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    preferences: z.array(preferenceInputSchema).max(32),
  })
  .strict()

const deleteQuerySchema = z.object({ expectedRevision: z.coerce.number().int().nonnegative().optional() }).strict()

async function readMemory(repository: Repository, actorId: string): Promise<AgentUserPreferenceMemory> {
  if (repository.getAgentUserPreferenceMemory) return repository.getAgentUserPreferenceMemory(actorId)
  return readAgentUserPreferenceMemory(await repository.getSettings(actorId))
}

async function compareAndSet(
  repository: Repository,
  actorId: string,
  expectedRevision: number,
  memory: AgentUserPreferenceMemory,
) {
  if (!repository.compareAndSetAgentUserPreferenceMemory) {
    throw new ApiError(503, 'AGENT_PREFERENCES_UNAVAILABLE', 'Agent preference persistence is unavailable')
  }
  if (!(await repository.compareAndSetAgentUserPreferenceMemory(actorId, expectedRevision, memory))) {
    throw new ApiError(409, 'AGENT_PREFERENCES_CONFLICT', 'Agent preferences changed; reload before saving')
  }
}

export function createAgentPreferenceRoutes(repository: Repository, now: () => Date = () => new Date()) {
  const app = new Hono<{ Variables: AppVariables }>()

  app.get('/preferences', async c => c.json({ memory: await readMemory(repository, c.get('actorId')) }))

  app.put('/preferences', async c => {
    const actorId = c.get('actorId')
    const body = await readJson(c, updateSchema)
    const current = await readMemory(repository, actorId)
    if (current.revision !== body.expectedRevision) {
      throw new ApiError(409, 'AGENT_PREFERENCES_CONFLICT', 'Agent preferences changed; reload before saving')
    }
    const ids = body.preferences.flatMap(preference => (preference.id ? [preference.id] : []))
    if (new Set(ids).size !== ids.length) {
      throw new ApiError(422, 'AGENT_PREFERENCES_INVALID', 'Agent preference IDs must be unique')
    }
    if (body.preferences.some(preference => !isAgentUserPreferenceContentSafe(preference.content))) {
      throw new ApiError(
        422,
        'AGENT_PREFERENCES_SENSITIVE',
        'Agent preferences must not contain credentials or secrets',
      )
    }
    const timestamp = now().toISOString()
    const existing = new Map(current.preferences.map(preference => [preference.id, preference]))
    const memory: AgentUserPreferenceMemory = {
      version: 1,
      revision: current.revision + 1,
      enabled: body.enabled,
      preferences: body.preferences.map(preference => {
        const id = preference.id ?? randomUUID()
        const previous = existing.get(id)
        const unchanged =
          previous?.category === preference.category &&
          previous.content === preference.content &&
          previous.source === preference.source
        return {
          id,
          category: preference.category,
          content: preference.content,
          source: preference.source,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: unchanged ? previous.updatedAt : timestamp,
        }
      }),
      updatedAt: timestamp,
    }
    await compareAndSet(repository, actorId, body.expectedRevision, memory)
    return c.json({ memory })
  })

  app.delete('/preferences', async c => {
    const actorId = c.get('actorId')
    const query = deleteQuerySchema.parse(c.req.query())
    const current = await readMemory(repository, actorId)
    const expectedRevision = query.expectedRevision ?? current.revision
    if (current.revision !== expectedRevision) {
      throw new ApiError(409, 'AGENT_PREFERENCES_CONFLICT', 'Agent preferences changed; reload before clearing')
    }
    const memory: AgentUserPreferenceMemory = {
      version: 1,
      revision: current.revision + 1,
      enabled: false,
      preferences: [],
      updatedAt: now().toISOString(),
    }
    await compareAndSet(repository, actorId, expectedRevision, memory)
    return c.json({ memory })
  })

  return app
}
