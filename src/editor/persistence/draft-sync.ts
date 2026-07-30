export type DraftSyncStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

export type DraftSyncSnapshot = {
  status: DraftSyncStatus
  version: number
  savedAt: string | null
  error: Error | null
}

type DraftSyncOptions<TSchema> = {
  initialVersion: number
  initialSavedAt?: string | null
  autoSave?: boolean
  debounceMs?: number
  exportSchema: () => TSchema
  save: (
    schema: TSchema,
    expectedVersion: number,
  ) => Promise<{ draftVersion: number; savedAt?: string; updatedAt?: string }>
}

function isConflictError(error: unknown): error is Error & { status: number } {
  return error instanceof Error && 'status' in error && error.status === 409
}

export class DraftSync<TSchema> {
  readonly #debounceMs: number
  readonly #autoSave: boolean
  readonly #exportSchema: () => TSchema
  readonly #save: DraftSyncOptions<TSchema>['save']
  readonly #listeners = new Set<() => void>()

  #version: number
  #savedAt: string | null
  #status: DraftSyncStatus = 'idle'
  #error: Error | null = null
  #snapshot: DraftSyncSnapshot
  #dirty = false
  #timer: ReturnType<typeof setTimeout> | null = null
  #flushPromise: Promise<void> | null = null
  #closePromise: Promise<void> | null = null
  #frozenCloseSchema: TSchema | undefined
  #hasFrozenCloseSchema = false
  #conflictSchema: TSchema | undefined
  #closing = false
  #disposed = false

  constructor(options: DraftSyncOptions<TSchema>) {
    this.#version = options.initialVersion
    this.#savedAt = options.initialSavedAt ?? null
    this.#snapshot = {
      status: this.#status,
      version: this.#version,
      savedAt: this.#savedAt,
      error: this.#error,
    }
    this.#debounceMs = options.debounceMs ?? 900
    this.#autoSave = options.autoSave ?? true
    this.#exportSchema = options.exportSchema
    this.#save = options.save
  }

  getSnapshot = (): DraftSyncSnapshot => this.#snapshot

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getConflictSchema = (): TSchema | undefined => this.#conflictSchema

  markDirty = () => {
    if (this.#closing || this.#disposed || this.#status === 'conflict') return

    this.#dirty = true
    if (this.#status !== 'saving') {
      this.#setSnapshot('dirty', null)
    }
    if (this.#autoSave) {
      this.#schedule()
    }
  }

  flush = async () => {
    if (this.#disposed || this.#status === 'conflict') return

    this.#clearTimer()
    if (this.#flushPromise) {
      await this.#flushPromise
      return
    }

    if (!this.#dirty && this.#status !== 'error') return

    this.#flushPromise = this.#runFlushLoop().finally(() => {
      this.#flushPromise = null
    })

    await this.#flushPromise
  }

  retry = async () => {
    if (this.#status !== 'error') return
    this.#dirty = true
    this.#setSnapshot('dirty', null)
    await this.flush()
  }

  acceptReloadedVersion = (version: number, savedAt: string | null = this.#savedAt) => {
    this.#version = version
    this.#savedAt = savedAt
    this.#dirty = false
    this.#conflictSchema = undefined
    this.#setSnapshot('saved', null)
  }

  reportConflict = (error: unknown, schema?: TSchema) => {
    const normalized = error instanceof Error ? error : new Error('项目草稿版本冲突')
    if (schema !== undefined) {
      this.#conflictSchema = schema
    } else {
      try {
        this.#conflictSchema = this.#exportSchema()
      } catch {
        this.#conflictSchema = undefined
      }
    }
    this.#dirty = true
    this.#setSnapshot('conflict', normalized)
  }

  flushAndDispose = () => {
    if (this.#closePromise) return this.#closePromise
    if (this.#disposed) return Promise.resolve()

    this.#closing = true
    this.#clearTimer()
    this.#listeners.clear()

    if (this.#dirty || this.#status === 'error') {
      try {
        this.#frozenCloseSchema = this.#exportSchema()
        this.#hasFrozenCloseSchema = true
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error('读取项目草稿失败')
        this.#setSnapshot('error', normalized)
      }
    }

    this.#closePromise = this.flush().finally(this.dispose)
    return this.#closePromise
  }

  dispose = () => {
    if (this.#disposed) return
    this.#closing = true
    this.#disposed = true
    this.#clearTimer()
    this.#listeners.clear()
  }

  async #runFlushLoop() {
    while (this.#dirty && !this.#disposed && this.#status !== 'conflict') {
      this.#dirty = false
      this.#setSnapshot('saving', null)
      let attemptedSchema: TSchema | undefined

      try {
        attemptedSchema = this.#hasFrozenCloseSchema ? this.#frozenCloseSchema! : this.#exportSchema()
        this.#frozenCloseSchema = undefined
        this.#hasFrozenCloseSchema = false
        const result = await this.#save(attemptedSchema, this.#version)
        if (this.#disposed) return
        this.#version = result.draftVersion
        this.#savedAt = result.savedAt ?? result.updatedAt ?? this.#savedAt
        this.#setSnapshot(this.#dirty ? 'dirty' : 'saved', null)
      } catch (error) {
        this.#dirty = true
        const normalized = error instanceof Error ? error : new Error('保存项目失败')

        if (isConflictError(error)) {
          this.reportConflict(normalized, attemptedSchema)
          return
        }

        this.#setSnapshot('error', normalized)
        return
      }
    }
  }

  #schedule() {
    this.#clearTimer()
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.flush()
    }, this.#debounceMs)
  }

  #clearTimer() {
    if (!this.#timer) return
    clearTimeout(this.#timer)
    this.#timer = null
  }

  #setSnapshot(status: DraftSyncStatus, error: Error | null) {
    this.#status = status
    this.#error = error
    this.#snapshot = {
      status,
      version: this.#version,
      savedAt: this.#savedAt,
      error,
    }
    for (const listener of this.#listeners) listener()
  }
}
