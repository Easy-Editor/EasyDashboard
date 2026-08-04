import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repository = readFileSync(new URL('./repository.ts', import.meta.url), 'utf8')

describe('Agent provider attempt repository accounting', () => {
  it('stores prompt, completion, and cached tokens in their separate columns', () => {
    const completion = repository.slice(
      repository.indexOf('completeAgentProviderAttempt(actorId'),
      repository.indexOf('reconcileAgentProviderAttempt(actorId'),
    )
    expect(completion).toContain('promptTokens: input.promptTokens ?? null')
    expect(completion).toContain('completionTokens: input.completionTokens ?? null')
    expect(completion).toContain('cachedTokens: input.cachedTokens ?? null')
    expect(completion).toContain('durationMs: input.providerAttempt.durationMs ?? null')
    expect(completion).not.toContain('promptTokens: input.observedTokens')
  })

  it('always scopes task-budget aggregation by actor, project, and task', () => {
    const sections = [
      repository.slice(repository.indexOf('enqueueAgentTurn(actorId'), repository.indexOf('getAgentTurnByDispatch')),
      repository.slice(
        repository.indexOf('prepareAgentProviderAttempt(actorId'),
        repository.indexOf('markAgentProviderAttemptStarted'),
      ),
      repository.slice(repository.indexOf('respondToAgentTask(actorId'), repository.indexOf('getAgentRunDispatch(')),
      repository.slice(
        repository.indexOf('async reserveAgentRunCost(actorId'),
        repository.indexOf('async settleAgentRunCost'),
      ),
    ]
    for (const section of sections) {
      const taskUsage = section.slice(section.indexOf('taskMicros:'), section.indexOf('projectMonthMicros:'))
      expect(taskUsage).toContain('${agentRunCosts.actorId} = ${actorId}')
      expect(taskUsage).toContain('${agentRunCosts.projectId} = ${input.projectId}')
      expect(taskUsage).toContain('${agentRunCosts.taskId} = ${input.taskId}')
    }
  })
})
