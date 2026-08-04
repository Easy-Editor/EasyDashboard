export type SafeAgentUndoSuccess<T> = {
  ok: true
  schema: T
  revertedPaths: string[]
}

export type SafeAgentUndoConflict = {
  ok: false
  conflictPaths: string[]
}

export type SafeAgentUndoResult<T> = SafeAgentUndoSuccess<T> | SafeAgentUndoConflict

const MISSING = Symbol('missing')
const MAX_DEPTH = 128
const MAX_PATH_LENGTH = 1024
const MAX_SEGMENT_LENGTH = 160

type Slot = unknown | typeof MISSING

type MergeResult = {
  value: Slot
  revertedPaths: string[]
  conflictPaths: string[]
}

type ArrayIdentity = {
  token: string
  pathSegment: string
}

type KeyedArray = {
  order: string[]
  values: Map<string, unknown>
  pathSegments: Map<string, string>
}

function isRecord(value: Slot): value is Record<string, unknown> {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36)
}

function boundPart(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  const suffix = `~${hash(value)}`
  return `${value.slice(0, maximum - suffix.length)}${suffix}`
}

function escapePathPart(value: string): string {
  return boundPart(value.replaceAll('~', '~0').replaceAll('/', '~1'), MAX_SEGMENT_LENGTH)
}

function appendPath(path: string, part: string): string {
  const candidate = path === '/' ? `/${escapePathPart(part)}` : `${path}/${escapePathPart(part)}`
  return boundPart(candidate, MAX_PATH_LENGTH)
}

function canonicalEqual(left: Slot, right: Slot, depth = 0): boolean {
  if (left === right) return true
  if (depth >= MAX_DEPTH || left === MISSING || right === MISSING) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => canonicalEqual(value, right[index], depth + 1))
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    if (!canonicalEqual(leftKeys, rightKeys, depth + 1)) return false
    return leftKeys.every(key => canonicalEqual(left[key], right[key], depth + 1))
  }
  return false
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function result(value: Slot, revertedPaths: string[] = [], conflictPaths: string[] = []): MergeResult {
  return { value, revertedPaths, conflictPaths }
}

function atomicUndo(base: Slot, applied: Slot, current: Slot, path: string): MergeResult {
  if (canonicalEqual(current, applied)) {
    return result(base === MISSING ? MISSING : clone(base), [path])
  }
  if (canonicalEqual(current, base)) return result(current, [path])
  return result(current, [], [path])
}

function nonEmptyIdentity(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function arrayIdentity(value: unknown): ArrayIdentity | null {
  if (!isRecord(value)) return null
  const meta = isRecord(value.meta) ? value.meta : null
  const easyDashboard = meta && isRecord(meta.easyDashboard) ? meta.easyDashboard : null
  const candidates: Array<[string, unknown]> = [
    ['pageId', easyDashboard?.pageId],
    ['docId', value.docId],
    ['id', value.id],
  ]
  for (const [kind, candidate] of candidates) {
    const identity = nonEmptyIdentity(candidate)
    if (identity) {
      return {
        token: `${kind}:${identity}`,
        pathSegment: `@${kind}=${identity}`,
      }
    }
  }
  return null
}

function keyedArray(value: unknown[]): KeyedArray | null {
  const order: string[] = []
  const values = new Map<string, unknown>()
  const pathSegments = new Map<string, string>()
  for (const item of value) {
    const identity = arrayIdentity(item)
    if (!identity || values.has(identity.token)) return null
    order.push(identity.token)
    values.set(identity.token, item)
    pathSegments.set(identity.token, identity.pathSegment)
  }
  return { order, values, pathSegments }
}

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function insertInBaseOrder(values: unknown[], item: unknown, token: string, baseOrder: string[]): void {
  const currentTokens = values.map(value => arrayIdentity(value)?.token ?? '')
  const baseIndex = baseOrder.indexOf(token)
  for (let index = baseIndex + 1; index < baseOrder.length; index += 1) {
    const successorIndex = currentTokens.indexOf(baseOrder[index] ?? '')
    if (successorIndex >= 0) {
      values.splice(successorIndex, 0, clone(item))
      return
    }
  }
  for (let index = baseIndex - 1; index >= 0; index -= 1) {
    const predecessorIndex = currentTokens.indexOf(baseOrder[index] ?? '')
    if (predecessorIndex >= 0) {
      values.splice(predecessorIndex + 1, 0, clone(item))
      return
    }
  }
  values.push(clone(item))
}

function undoKeyedArray(
  base: unknown[],
  applied: unknown[],
  current: unknown[],
  path: string,
  depth: number,
  baseKeyed: KeyedArray,
  appliedKeyed: KeyedArray,
): MergeResult {
  const revertedPaths: string[] = []
  const conflictPaths: string[] = []
  const output = clone(current)
  const allTaskTokens = [...new Set([...baseKeyed.order, ...appliedKeyed.order])].sort()

  for (const token of allTaskTokens) {
    const baseValue = baseKeyed.values.get(token) ?? MISSING
    const appliedValue = appliedKeyed.values.get(token) ?? MISSING
    if (canonicalEqual(baseValue, appliedValue)) continue
    const segment = baseKeyed.pathSegments.get(token) ?? appliedKeyed.pathSegments.get(token) ?? token
    const itemPath = appendPath(path, segment)
    const currentIndex = output.findIndex(value => arrayIdentity(value)?.token === token)
    const currentValue = currentIndex >= 0 ? output[currentIndex] : MISSING

    if (baseValue === MISSING || appliedValue === MISSING) {
      const merged = atomicUndo(baseValue, appliedValue, currentValue, itemPath)
      revertedPaths.push(...merged.revertedPaths)
      conflictPaths.push(...merged.conflictPaths)
      if (merged.conflictPaths.length > 0) continue
      if (merged.value === MISSING && currentIndex >= 0) output.splice(currentIndex, 1)
      if (merged.value !== MISSING && currentIndex < 0) {
        insertInBaseOrder(output, merged.value, token, baseKeyed.order)
      }
      continue
    }

    const merged = undoNode(baseValue, appliedValue, currentValue, itemPath, depth + 1)
    revertedPaths.push(...merged.revertedPaths)
    conflictPaths.push(...merged.conflictPaths)
    if (merged.conflictPaths.length === 0 && currentIndex >= 0 && merged.value !== MISSING) {
      output[currentIndex] = merged.value
    }
  }

  const commonTokens = baseKeyed.order.filter(token => appliedKeyed.values.has(token))
  const appliedCommonOrder = appliedKeyed.order.filter(token => baseKeyed.values.has(token))
  if (!sameOrder(commonTokens, appliedCommonOrder)) {
    const outputKeyed = keyedArray(output)
    const outputCommonOrder = outputKeyed?.order.filter(
      token => baseKeyed.values.has(token) && appliedKeyed.values.has(token),
    )
    if (!outputKeyed || !outputCommonOrder || outputCommonOrder.length !== commonTokens.length) {
      conflictPaths.push(path)
    } else if (sameOrder(outputCommonOrder, appliedCommonOrder)) {
      const reorderedValues = new Map(commonTokens.map(token => [token, outputKeyed.values.get(token)]))
      let commonIndex = 0
      for (let index = 0; index < output.length; index += 1) {
        const token = arrayIdentity(output[index])?.token
        if (token && reorderedValues.has(token)) {
          const baseToken = commonTokens[commonIndex]
          if (baseToken) output[index] = reorderedValues.get(baseToken)
          commonIndex += 1
        }
      }
      revertedPaths.push(path)
    } else if (sameOrder(outputCommonOrder, commonTokens)) {
      revertedPaths.push(path)
    } else {
      conflictPaths.push(path)
    }
  }

  return result(output, revertedPaths, conflictPaths)
}

function undoArray(base: unknown[], applied: unknown[], current: Slot, path: string, depth: number): MergeResult {
  if (!Array.isArray(current)) return atomicUndo(base, applied, current, path)
  const baseKeyed = keyedArray(base)
  const appliedKeyed = keyedArray(applied)
  const currentKeyed = keyedArray(current)
  const canUseKeys =
    (base.length > 0 || applied.length > 0) && baseKeyed !== null && appliedKeyed !== null && currentKeyed !== null
  if (!canUseKeys) return atomicUndo(base, applied, current, path)
  return undoKeyedArray(base, applied, current, path, depth, baseKeyed, appliedKeyed)
}

function undoObject(
  base: Record<string, unknown>,
  applied: Record<string, unknown>,
  current: Record<string, unknown>,
  path: string,
  depth: number,
): MergeResult {
  const output = Object.fromEntries(Object.entries(current).map(([key, value]) => [key, clone(value)]))
  const revertedPaths: string[] = []
  const conflictPaths: string[] = []
  const keys = [...new Set([...Object.keys(base), ...Object.keys(applied)])].sort()

  for (const key of keys) {
    const baseValue: Slot = Object.hasOwn(base, key) ? base[key] : MISSING
    const appliedValue: Slot = Object.hasOwn(applied, key) ? applied[key] : MISSING
    if (canonicalEqual(baseValue, appliedValue)) continue
    const currentValue: Slot = Object.hasOwn(current, key) ? current[key] : MISSING
    const merged = undoNode(baseValue, appliedValue, currentValue, appendPath(path, key), depth + 1)
    revertedPaths.push(...merged.revertedPaths)
    conflictPaths.push(...merged.conflictPaths)
    if (merged.conflictPaths.length > 0) continue
    if (merged.value === MISSING) delete output[key]
    else output[key] = merged.value
  }

  return result(output, revertedPaths, conflictPaths)
}

function undoNode(base: Slot, applied: Slot, current: Slot, path: string, depth: number): MergeResult {
  if (canonicalEqual(base, applied)) return result(current === MISSING ? MISSING : clone(current))
  if (depth >= MAX_DEPTH) return atomicUndo(base, applied, current, path)
  if (Array.isArray(base) && Array.isArray(applied)) return undoArray(base, applied, current, path, depth)
  if (isRecord(base) && isRecord(applied) && isRecord(current)) {
    return undoObject(base, applied, current, path, depth)
  }
  return atomicUndo(base, applied, current, path)
}

function uniqueSorted(paths: string[]): string[] {
  return [...new Set(paths)].sort()
}

/**
 * Reverses only the changes from `baseSchema` to `appliedSchema` when the
 * corresponding values in `currentSchema` still have the task's after-value
 * (or are already back at the before-value). Unrelated later edits are kept.
 */
export function safeAgentUndo<T>(baseSchema: T, appliedSchema: T, currentSchema: T): SafeAgentUndoResult<T> {
  const merged = undoNode(baseSchema, appliedSchema, currentSchema, '/', 0)
  const conflictPaths = uniqueSorted(merged.conflictPaths)
  if (conflictPaths.length > 0) return { ok: false, conflictPaths }
  return {
    ok: true,
    schema: merged.value as T,
    revertedPaths: uniqueSorted(merged.revertedPaths),
  }
}
