import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentExecutorAbortedError,
  type AgentExecutorRunnerOptions,
  createAgentExecutorRunner,
} from './agent-executor-runner.js'

const workflowInput = {
  operationId: 'operation-1',
  grantToken: 'grant-token',
  recoveryGrantToken: 'recovery-grant-token',
}

function createRunner(spawnProcess: typeof spawn, overrides: Partial<AgentExecutorRunnerOptions> = {}) {
  const runner = createAgentExecutorRunner({
    cliPath: '/opt/easy-dashboard/document-executor.mjs',
    dashboardUrl: 'https://app.example.com/projects/project-1/editor',
    apiOrigin: 'https://api.example.com',
    ...overrides,
    spawnProcess,
  })
  if (!runner) throw new Error('Expected a configured Agent executor runner')
  return runner
}

function createHangingProcess() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  child.stdin = stdin
  child.stdout = stdout
  child.stderr = stderr
  let terminated = false
  child.kill = () => {
    terminated = true
    queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
    return true
  }
  return { child, stdout, stderr, wasTerminated: () => terminated }
}

describe('Agent executor runner cancellation', () => {
  it('does not start the executor when the workflow was already cancelled', async () => {
    const spawnProcess = vi.fn() as unknown as typeof spawn
    const controller = new AbortController()
    controller.abort('cancel')
    const runner = createRunner(spawnProcess)

    const result = runner.run({ ...workflowInput, signal: controller.signal })

    await expect(result).rejects.toBeInstanceOf(AgentExecutorAbortedError)
    await expect(result).rejects.toMatchObject({ name: 'AgentExecutorAbortedError', reason: 'cancel' })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('terminates a running executor and preserves the pause reason', async () => {
    const processHarness = createHangingProcess()
    const spawnProcess = vi.fn(() => processHarness.child) as unknown as typeof spawn
    const controller = new AbortController()
    const runner = createRunner(spawnProcess)

    const result = runner.run({ ...workflowInput, signal: controller.signal }).catch(error => error as unknown)
    controller.abort('pause')
    const error = await result

    expect(error).toBeInstanceOf(AgentExecutorAbortedError)
    expect(error).toMatchObject({ name: 'AgentExecutorAbortedError', reason: 'pause' })
    expect(processHarness.wasTerminated()).toBe(true)
  })
})

describe('Agent executor runner existing behavior', () => {
  it('does not expose server credentials or arbitrary environment variables to the executor', async () => {
    vi.stubEnv('PATH', '/usr/local/bin:/usr/bin')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LANG', 'en_US.UTF-8')
    vi.stubEnv('DATABASE_URL', 'postgres://dashboard-secret')
    vi.stubEnv('AGENT_EXECUTOR_GRANT_SECRET', 'signing-secret')
    vi.stubEnv('OPENAI_API_KEY', 'model-secret')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'storage-secret')
    vi.stubEnv('EASY_DASHBOARD_INTERNAL_TOKEN', 'dashboard-secret')
    vi.stubEnv('HTTPS_PROXY', 'https://proxy-user:proxy-password@proxy.example.com')

    try {
      const processHarness = createHangingProcess()
      const expected = {
        prepared: null,
        outcome: {
          operationId: workflowInput.operationId,
          status: 'committed',
        },
        recovery: { classification: 'not-needed', browserExecuted: true },
      }
      let spawnedEnvironment: NodeJS.ProcessEnv | undefined
      let stdin = ''
      processHarness.child.stdin.on('data', chunk => {
        stdin += chunk.toString()
      })
      const spawnProcess = vi.fn((_command: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
        spawnedEnvironment = options.env
        queueMicrotask(() => {
          processHarness.stdout.write(JSON.stringify(expected))
          processHarness.child.emit('close', 0, null)
        })
        return processHarness.child
      })
      const runner = createRunner(spawnProcess as unknown as typeof spawn)

      await runner.run(workflowInput)

      expect(spawnedEnvironment).toBeDefined()
      const environment = spawnedEnvironment ?? {}
      expect(environment).toMatchObject({
        PATH: '/usr/local/bin:/usr/bin',
        NODE_ENV: 'production',
        LANG: 'en_US.UTF-8',
        EASY_EDITOR_DOCUMENT_EXECUTOR_DASHBOARD_URL: 'https://app.example.com/projects/project-1/editor',
        EASY_EDITOR_DOCUMENT_EXECUTOR_DEBUG: '0',
      })
      const allowedNames = new Set([
        'PATH',
        'NODE_ENV',
        'LANG',
        'LC_ALL',
        'LC_CTYPE',
        'TMPDIR',
        'TEMP',
        'TMP',
        'NODE_EXTRA_CA_CERTS',
        'SSL_CERT_FILE',
        'SSL_CERT_DIR',
        'EASY_EDITOR_DOCUMENT_EXECUTOR_DASHBOARD_URL',
        'EASY_EDITOR_DOCUMENT_EXECUTOR_DEBUG',
      ])
      expect(Object.keys(environment).every(name => allowedNames.has(name))).toBe(true)
      expect(environment).not.toHaveProperty('DATABASE_URL')
      expect(environment).not.toHaveProperty('AGENT_EXECUTOR_GRANT_SECRET')
      expect(environment).not.toHaveProperty('OPENAI_API_KEY')
      expect(environment).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
      expect(environment).not.toHaveProperty('EASY_DASHBOARD_INTERNAL_TOKEN')
      expect(environment).not.toHaveProperty('HTTPS_PROXY')
      expect(Object.values(environment)).not.toContain(workflowInput.grantToken)
      expect(Object.values(environment)).not.toContain(workflowInput.recoveryGrantToken)
      expect(JSON.parse(stdin)).toMatchObject({
        grantToken: workflowInput.grantToken,
        recoveryGrantToken: workflowInput.recoveryGrantToken,
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('still returns a valid committed workflow result', async () => {
    const processHarness = createHangingProcess()
    const expected = {
      prepared: null,
      outcome: {
        operationId: workflowInput.operationId,
        status: 'committed',
        candidateSha256: 'a'.repeat(64),
        committedDraftVersion: 8,
      },
      recovery: { classification: 'not-needed', browserExecuted: true },
    }
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        processHarness.stdout.write(JSON.stringify(expected))
        processHarness.child.emit('close', 0, null)
      })
      return processHarness.child
    }) as unknown as typeof spawn
    const runner = createRunner(spawnProcess)

    await expect(runner.run(workflowInput)).resolves.toEqual(expected)
  })

  it('still terminates a timed-out executor with the existing runner error', async () => {
    const processHarness = createHangingProcess()
    const spawnProcess = vi.fn(() => processHarness.child) as unknown as typeof spawn
    const runner = createRunner(spawnProcess, { timeoutMs: 1 })

    const error = await runner.run(workflowInput).catch(reason => reason as unknown)

    expect(error).toMatchObject({ name: 'AgentExecutorRunnerError' })
    expect(error).toMatchObject({ code: 'EXECUTOR_TIMEOUT' })
    expect(processHarness.wasTerminated()).toBe(true)
  })

  it('still rejects invalid executor output with the existing safe error', async () => {
    const processHarness = createHangingProcess()
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        processHarness.stdout.write('not-json')
        processHarness.child.emit('close', 0, null)
      })
      return processHarness.child
    }) as unknown as typeof spawn
    const runner = createRunner(spawnProcess)

    const error = await runner.run(workflowInput).catch(reason => reason as unknown)

    expect(error).toMatchObject({
      name: 'AgentExecutorRunnerError',
      message: 'Document executor failed [EXECUTOR_INVALID_OUTPUT]',
      code: 'EXECUTOR_INVALID_OUTPUT',
    })
  })

  it('never exposes stderr credentials in the thrown or serialized runner error', async () => {
    const processHarness = createHangingProcess()
    const stderrSecret = 'stderr-secret=sk-live-SENTINEL-DO-NOT-LOG'
    const stdoutSecret = 'stdout-secret=grant-SENTINEL-DO-NOT-LOG'
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        processHarness.stdout.write(stdoutSecret)
        processHarness.stderr.write(stderrSecret)
        processHarness.child.emit('close', 17, null)
      })
      return processHarness.child
    }) as unknown as typeof spawn
    const runner = createRunner(spawnProcess)

    const error = (await runner.run(workflowInput).catch(reason => reason)) as Error & Record<string, unknown>
    const serialized = JSON.stringify(error)
    const loggable = String(error)
    const inspected = inspect(error)

    expect(error).toMatchObject({
      name: 'AgentExecutorRunnerError',
      message: 'Document executor failed [EXECUTOR_PROCESS_FAILED]',
      code: 'EXECUTOR_PROCESS_FAILED',
      diagnostics: {
        exitCode: 17,
        stdoutBytes: Buffer.byteLength(stdoutSecret),
        stdoutSha256: createHash('sha256').update(stdoutSecret).digest('hex'),
        stderrBytes: Buffer.byteLength(stderrSecret),
        stderrSha256: createHash('sha256').update(stderrSecret).digest('hex'),
      },
    })
    expect(error.message).not.toContain(stderrSecret)
    expect(error.message).not.toContain(stdoutSecret)
    expect(serialized).not.toContain(stderrSecret)
    expect(serialized).not.toContain(stdoutSecret)
    expect(loggable).not.toContain(stderrSecret)
    expect(loggable).not.toContain(stdoutSecret)
    expect(inspected).not.toContain(stderrSecret)
    expect(inspected).not.toContain(stdoutSecret)
    expect(serialized).not.toContain(workflowInput.grantToken)
    expect(serialized).not.toContain(workflowInput.recoveryGrantToken)
  })

  it('preserves the bounded failure fields reported by the CLI', async () => {
    const processHarness = createHangingProcess()
    const cliFailure = {
      code: 'DOCUMENT_MUTATION_REJECTED',
      message: '文档变更被编辑器拒绝',
    }
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        processHarness.stdout.write(
          JSON.stringify({
            schemaVersion: 1,
            status: 'failed',
            failure: cliFailure,
          }),
        )
        processHarness.child.emit('close', 1, null)
      })
      return processHarness.child
    }) as unknown as typeof spawn
    const runner = createRunner(spawnProcess)

    const error = (await runner.run(workflowInput).catch(reason => reason)) as Error & Record<string, unknown>

    expect(error).toMatchObject({
      message: 'Document executor failed [EXECUTOR_CLI_REPORTED_FAILURE]',
      code: 'EXECUTOR_CLI_REPORTED_FAILURE',
      diagnostics: { exitCode: 1 },
      failure: cliFailure,
    })
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({ failure: cliFailure })
  })
})
