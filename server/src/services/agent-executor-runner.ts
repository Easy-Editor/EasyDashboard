import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const MAX_STDOUT_BYTES = 1024 * 1024
const EXECUTOR_ENV_ALLOWLIST = [
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
] as const

const workflowResultSchema = z
  .object({
    prepared: z.unknown().nullable(),
    outcome: z
      .object({
        operationId: z.string().min(1),
        status: z.string().min(1),
        candidateSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        committedDraftVersion: z.number().int().nonnegative().optional(),
        commitReceipt: z.unknown().optional(),
      })
      .passthrough(),
    recovery: z
      .object({
        classification: z.string().min(1),
        browserExecuted: z.boolean(),
      })
      .passthrough(),
  })
  .strict()

const cliFailureSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal('failed'),
    failure: z
      .object({
        code: z.string().min(1).max(120),
        message: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict()

export type AgentExecutorWorkflowResult = z.infer<typeof workflowResultSchema>

export type AgentExecutorAbortReason = 'pause' | 'cancel'

export type AgentExecutorRunnerErrorCode =
  | 'EXECUTOR_CLI_REPORTED_FAILURE'
  | 'EXECUTOR_INVALID_OUTPUT'
  | 'EXECUTOR_INVALID_WORKFLOW_RESULT'
  | 'EXECUTOR_OPERATION_MISMATCH'
  | 'EXECUTOR_OUTPUT_LIMIT_EXCEEDED'
  | 'EXECUTOR_PROCESS_FAILED'
  | 'EXECUTOR_SCREENSHOT_ARTIFACT_FAILED'
  | 'EXECUTOR_TIMEOUT'
  | 'EXECUTOR_UNCOMMITTED_OUTCOME'

export interface AgentExecutorRunnerDiagnostics {
  exitCode: number | null
  stdoutBytes: number
  stdoutSha256: string
  stderrBytes: number
  stderrSha256: string
}

export interface AgentExecutorCliFailure {
  code: string
  message: string
}

export class AgentExecutorRunnerError extends Error {
  readonly name = 'AgentExecutorRunnerError'

  constructor(
    public readonly code: AgentExecutorRunnerErrorCode,
    public readonly diagnostics: AgentExecutorRunnerDiagnostics,
    public readonly failure?: AgentExecutorCliFailure,
  ) {
    super(`Document executor failed [${code}]`)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      diagnostics: this.diagnostics,
      ...(this.failure ? { failure: this.failure } : {}),
    }
  }
}

export class AgentExecutorAbortedError extends Error {
  readonly name = 'AgentExecutorAbortedError'

  constructor(public readonly reason: AgentExecutorAbortReason) {
    super(reason === 'pause' ? 'Document executor was paused' : 'Document executor was cancelled')
  }
}

export interface AgentExecutorWorkflowInput {
  actorId: string
  projectId: string
  operationId: string
  grantToken: string
  recoveryGrantToken: string
  signal?: AbortSignal
}

export interface AgentExecutorRunner {
  run(input: AgentExecutorWorkflowInput): Promise<AgentExecutorWorkflowResult>
}

export interface AgentExecutorRunnerOptions {
  cliPath?: string
  dashboardUrl?: string
  apiOrigin?: string
  timeoutMs?: number
  spawnProcess?: typeof spawn
  persistScreenshotArtifact?: (input: {
    actorId: string
    projectId: string
    operationId: string
    bytes: Uint8Array
  }) => Promise<void>
}

function endpointSet(apiOrigin: string, operationId: string) {
  const origin = new URL(apiOrigin).origin
  const encoded = encodeURIComponent(operationId)
  const prefix = `${origin}/api/agent-spike/operations/${encoded}`
  return {
    origin,
    endpoints: {
      input: `${prefix}/input`,
      prepared: `${prefix}/prepared`,
      commit: `${prefix}/commit`,
      outcome: `${prefix}/outcome`,
    },
  }
}

function safeRunnerError(
  code: AgentExecutorRunnerErrorCode,
  diagnostics: AgentExecutorRunnerDiagnostics,
  failure?: AgentExecutorCliFailure,
): AgentExecutorRunnerError {
  return new AgentExecutorRunnerError(code, diagnostics, failure)
}

function abortReason(signal: AbortSignal): AgentExecutorAbortReason {
  return signal.reason === 'pause' ? 'pause' : 'cancel'
}

function executorEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const name of EXECUTOR_ENV_ALLOWLIST) {
    const value = source[name]
    if (value !== undefined) environment[name] = value
  }
  return environment
}

export function createAgentExecutorRunner(options: AgentExecutorRunnerOptions): AgentExecutorRunner | null {
  if (!options.cliPath || !options.dashboardUrl || !options.apiOrigin) return null
  const dashboardUrl = new URL(options.dashboardUrl)
  const { origin: honoOrigin } = endpointSet(options.apiOrigin, 'probe')
  if (!['http:', 'https:'].includes(dashboardUrl.protocol)) return null

  return {
    async run(input) {
      if (input.signal?.aborted) throw new AgentExecutorAbortedError(abortReason(input.signal))
      const { endpoints } = endpointSet(honoOrigin, input.operationId)
      const artifactDirectory = options.persistScreenshotArtifact
        ? await mkdtemp(join(tmpdir(), 'easy-dashboard-agent-screenshot-'))
        : null
      const screenshotPath = artifactDirectory ? join(artifactDirectory, 'render.png') : null
      try {
        const child = (options.spawnProcess ?? spawn)(process.execPath, [options.cliPath as string], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...executorEnvironment(process.env),
            EASY_EDITOR_DOCUMENT_EXECUTOR_DASHBOARD_URL: dashboardUrl.toString(),
            EASY_EDITOR_DOCUMENT_EXECUTOR_DEBUG: process.env.NODE_ENV === 'production' ? '0' : '1',
            ...(screenshotPath ? { EASY_EDITOR_DOCUMENT_EXECUTOR_SCREENSHOT_PATH: screenshotPath } : {}),
          },
        })
        let stdout = ''
        let stdoutBytes = 0
        let stderrBytes = 0
        const stdoutHash = createHash('sha256')
        const stderrHash = createHash('sha256')
        let overflow = false
        child.stdout.on('data', chunk => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          stdoutBytes += buffer.byteLength
          stdoutHash.update(buffer)
          if (overflow) return
          stdout += buffer.toString()
          if (stdoutBytes > MAX_STDOUT_BYTES) {
            overflow = true
            child.kill('SIGKILL')
          }
        })
        child.stderr.on('data', chunk => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          stderrBytes += buffer.byteLength
          stderrHash.update(buffer)
        })

        let aborted: AgentExecutorAbortReason | null = null
        const abortChild = () => {
          if (!input.signal || aborted) return
          aborted = abortReason(input.signal)
          try {
            child.kill('SIGKILL')
          } catch {
            // The close/error path below remains authoritative if the process exited concurrently.
          }
        }
        input.signal?.addEventListener('abort', abortChild, { once: true })
        if (input.signal?.aborted) abortChild()

        let timedOut = false
        const timeout = setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, options.timeoutMs ?? 120_000)
        child.stdin.end(
          JSON.stringify({
            operationId: input.operationId,
            grantToken: input.grantToken,
            recoveryGrantToken: input.recoveryGrantToken,
            honoOrigin,
            endpoints,
          }),
        )

        let exitCode: number | null
        try {
          ;[exitCode] = (await once(child, 'close')) as [number | null]
        } finally {
          clearTimeout(timeout)
          input.signal?.removeEventListener('abort', abortChild)
        }
        if (aborted) throw new AgentExecutorAbortedError(aborted)
        const diagnostics: AgentExecutorRunnerDiagnostics = {
          exitCode,
          stdoutBytes,
          stdoutSha256: stdoutHash.digest('hex'),
          stderrBytes,
          stderrSha256: stderrHash.digest('hex'),
        }
        if (timedOut) throw safeRunnerError('EXECUTOR_TIMEOUT', diagnostics)
        if (overflow) throw safeRunnerError('EXECUTOR_OUTPUT_LIMIT_EXCEEDED', diagnostics)

        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(stdout) as unknown
        } catch {
          throw safeRunnerError(exitCode === 0 ? 'EXECUTOR_INVALID_OUTPUT' : 'EXECUTOR_PROCESS_FAILED', diagnostics)
        }
        const parsedFailure = cliFailureSchema.safeParse(parsedJson)
        if (parsedFailure.success) {
          throw safeRunnerError('EXECUTOR_CLI_REPORTED_FAILURE', diagnostics, parsedFailure.data.failure)
        }
        const parsed = workflowResultSchema.safeParse(parsedJson)
        if (!parsed.success || exitCode !== 0 || parsed.data.outcome.status !== 'committed') {
          throw safeRunnerError(
            exitCode !== 0
              ? 'EXECUTOR_PROCESS_FAILED'
              : parsed.success
                ? 'EXECUTOR_UNCOMMITTED_OUTCOME'
                : 'EXECUTOR_INVALID_WORKFLOW_RESULT',
            diagnostics,
          )
        }
        if (parsed.data.outcome.operationId !== input.operationId) {
          throw safeRunnerError('EXECUTOR_OPERATION_MISMATCH', diagnostics)
        }
        if (options.persistScreenshotArtifact && parsed.data.recovery.browserExecuted) {
          let bytes: Uint8Array
          try {
            bytes = new Uint8Array(await readFile(screenshotPath as string))
          } catch {
            throw safeRunnerError('EXECUTOR_SCREENSHOT_ARTIFACT_FAILED', diagnostics)
          }
          const prepared = parsed.data.prepared
          const expectedSha256 =
            prepared && typeof prepared === 'object'
              ? (prepared as { evidence?: { render?: { screenshotSha256?: unknown } } }).evidence?.render
                  ?.screenshotSha256
              : null
          if (
            typeof expectedSha256 !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(expectedSha256) ||
            createHash('sha256').update(bytes).digest('hex') !== expectedSha256
          ) {
            throw safeRunnerError('EXECUTOR_SCREENSHOT_ARTIFACT_FAILED', diagnostics)
          }
          try {
            await options.persistScreenshotArtifact({
              actorId: input.actorId,
              projectId: input.projectId,
              operationId: input.operationId,
              bytes,
            })
          } catch {
            throw safeRunnerError('EXECUTOR_SCREENSHOT_ARTIFACT_FAILED', diagnostics)
          }
        }
        return parsed.data
      } finally {
        if (artifactDirectory) await rm(artifactDirectory, { recursive: true, force: true }).catch(() => undefined)
      }
    },
  }
}
