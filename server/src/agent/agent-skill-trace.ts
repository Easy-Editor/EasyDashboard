import { z } from 'zod'

const traceIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*$/iu)
const traceVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._+-]*$/iu)
const traceSkillSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._+-]*$/iu)

/**
 * Durable provenance for the prompt bundle and declarative Skills selected for
 * one Agent operation. Only identifiers and a content digest are accepted;
 * prompt bodies, instructions, credentials, and arbitrary metadata have no
 * place in this contract.
 */
export const agentSkillTraceSchema = z
  .object({
    promptBundleId: traceIdentifierSchema,
    promptBundleVersion: traceVersionSchema,
    promptBundleHash: z.string().regex(/^[a-f0-9]{64}$/u),
    skills: z.array(traceSkillSchema).max(16),
  })
  .strict()
  .superRefine((trace, context) => {
    if (new Set(trace.skills).size !== trace.skills.length) {
      context.addIssue({ code: 'custom', path: ['skills'], message: 'Skill trace entries must be unique' })
    }
  })

export type AgentSkillTrace = z.infer<typeof agentSkillTraceSchema>

export function parseAgentSkillTrace(value: unknown): AgentSkillTrace {
  return agentSkillTraceSchema.parse(value)
}

export function agentSkillTraceMatches(left: AgentSkillTrace | null, right: AgentSkillTrace | null): boolean {
  if (!left || !right) return left === right
  return (
    left.promptBundleId === right.promptBundleId &&
    left.promptBundleVersion === right.promptBundleVersion &&
    left.promptBundleHash === right.promptBundleHash &&
    left.skills.length === right.skills.length &&
    left.skills.every((skill, index) => skill === right.skills[index])
  )
}
