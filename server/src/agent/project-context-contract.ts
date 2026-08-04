import { z } from 'zod'

export const projectContextStatusSchema = z.enum(['pending', 'confirmed'])
export const projectContextRevisionSchema = z
  .object({
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    content: z.string().max(20_000),
    status: projectContextStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
export const projectContextSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    content: z.string().max(20_000),
    status: projectContextStatusSchema,
    revision: z.number().int().positive(),
    history: z.array(projectContextRevisionSchema),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    confirmedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
export type ProjectContext = z.infer<typeof projectContextSchema>

export function assertProjectContextWritable(context: ProjectContext, expectedRevision: number): void {
  if (context.revision !== expectedRevision) throw new Error('PROJECT_CONTEXT_REVISION_CONFLICT')
}

export function appendProjectContextRevision(context: ProjectContext, now: string): ProjectContext {
  return {
    ...context,
    history: [
      ...context.history,
      {
        revision: context.revision,
        title: context.title,
        content: context.content,
        status: context.status,
        createdAt: context.updatedAt,
      },
    ],
    revision: context.revision + 1,
    updatedAt: now,
  }
}

export function rollbackProjectContextRevision(
  context: ProjectContext,
  targetRevision: number,
  now: string,
): ProjectContext {
  const target = context.history.find(item => item.revision === targetRevision)
  if (!target) throw new Error('PROJECT_CONTEXT_REVISION_NOT_FOUND')
  return {
    ...appendProjectContextRevision(context, now),
    title: target.title,
    content: target.content,
    status: target.status,
    confirmedAt: target.status === 'confirmed' ? now : undefined,
  }
}
