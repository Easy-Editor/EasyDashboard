import { describe, expect, it } from 'vitest'
import { safeAgentUndo } from './safe-agent-undo.js'

function expectSuccess<T>(result: ReturnType<typeof safeAgentUndo<T>>) {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`Expected undo success, got conflicts: ${result.conflictPaths.join(', ')}`)
  return result
}

describe('safeAgentUndo', () => {
  it('reverts task fields while preserving unrelated later fields without mutating inputs', () => {
    const base = { title: 'Before', theme: { mode: 'dark', accent: 'blue' } }
    const applied = { title: 'After', theme: { mode: 'dark', accent: 'blue' } }
    const current = { title: 'After', theme: { mode: 'light', accent: 'blue' }, later: true }
    const snapshots = structuredClone({ base, applied, current })

    const result = expectSuccess(safeAgentUndo(base, applied, current))

    expect(result.schema).toEqual({ title: 'Before', theme: { mode: 'light', accent: 'blue' }, later: true })
    expect(result.revertedPaths).toEqual(['/title'])
    expect({ base, applied, current }).toEqual(snapshots)
  })

  it('fails closed when a later edit changed the same field', () => {
    expect(safeAgentUndo({ title: 'Before' }, { title: 'After' }, { title: 'Later' })).toEqual({
      ok: false,
      conflictPaths: ['/title'],
    })
  })

  it('reverses keyed insertions and removals while retaining unrelated later items', () => {
    const base = {
      components: [
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ],
    }
    const applied = {
      components: [
        { id: 'b', value: 2 },
        { id: 'task', value: 3 },
      ],
    }
    const current = {
      components: [
        { id: 'later', value: 4 },
        { id: 'b', value: 2 },
        { id: 'task', value: 3 },
      ],
    }

    const result = expectSuccess(safeAgentUndo(base, applied, current))

    expect(result.schema).toEqual({
      components: [
        { id: 'later', value: 4 },
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ],
    })
    expect(result.revertedPaths).toEqual(['/components/@id=a', '/components/@id=task'])
  })

  it('reverses a task reorder but preserves later items in their slots', () => {
    const base = { components: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
    const applied = { components: [{ id: 'c' }, { id: 'a' }, { id: 'b' }] }
    const current = { components: [{ id: 'later-1' }, { id: 'c' }, { id: 'a' }, { id: 'later-2' }, { id: 'b' }] }

    const result = expectSuccess(safeAgentUndo(base, applied, current))

    expect(result.schema).toEqual({
      components: [{ id: 'later-1' }, { id: 'a' }, { id: 'b' }, { id: 'later-2' }, { id: 'c' }],
    })
    expect(result.revertedPaths).toEqual(['/components'])
  })

  it('fails closed when a later reorder overlaps the task reorder', () => {
    const base = { components: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
    const applied = { components: [{ id: 'c' }, { id: 'a' }, { id: 'b' }] }
    const current = { components: [{ id: 'b' }, { id: 'c' }, { id: 'a' }] }

    expect(safeAgentUndo(base, applied, current)).toEqual({ ok: false, conflictPaths: ['/components'] })
  })

  it('matches pages by meta.easyDashboard.pageId and components by id across reorders', () => {
    const page = (pageId: string, title: string, children: unknown[]) => ({
      id: `${pageId}-root`,
      docId: `${pageId}-doc`,
      meta: { easyDashboard: { pageId } },
      title,
      children,
    })
    const base = {
      componentsTree: [
        page('home', 'Home', [{ id: 'chart', props: { color: 'blue', title: 'Sales' } }]),
        page('detail', 'Detail', []),
      ],
    }
    const applied = {
      componentsTree: [
        page('detail', 'Detail', []),
        page('home', 'Home', [{ id: 'chart', props: { color: 'red', title: 'Sales' } }]),
      ],
    }
    const current = {
      componentsTree: [
        page('detail', 'Detail later', []),
        page('home', 'Home', [{ id: 'chart', props: { color: 'red', title: 'Sales later' } }]),
      ],
    }

    const result = expectSuccess(safeAgentUndo(base, applied, current))

    expect(result.schema).toEqual({
      componentsTree: [
        page('home', 'Home', [{ id: 'chart', props: { color: 'blue', title: 'Sales later' } }]),
        page('detail', 'Detail later', []),
      ],
    })
    expect(result.revertedPaths).toEqual([
      '/componentsTree',
      '/componentsTree/@pageId=home/children/@id=chart/props/color',
    ])
  })

  it('falls back to docId when page metadata and id are unavailable', () => {
    const base = { pages: [{ docId: 'overview', title: 'Before', later: 0 }] }
    const applied = { pages: [{ docId: 'overview', title: 'After', later: 0 }] }
    const current = { pages: [{ docId: 'overview', title: 'After', later: 1 }] }

    const result = expectSuccess(safeAgentUndo(base, applied, current))

    expect(result.schema).toEqual({ pages: [{ docId: 'overview', title: 'Before', later: 1 }] })
    expect(result.revertedPaths).toEqual(['/pages/@docId=overview/title'])
  })

  it('treats an already reverted schema as an idempotent success', () => {
    const base = { settings: { title: 'Before' }, components: [{ id: 'a' }, { id: 'b' }] }
    const applied = { settings: { title: 'After' }, components: [{ id: 'b' }, { id: 'a' }] }

    const first = expectSuccess(safeAgentUndo(base, applied, applied))
    const second = expectSuccess(safeAgentUndo(base, applied, first.schema))

    expect(second.schema).toEqual(base)
    expect(second.revertedPaths).toEqual(first.revertedPaths)
  })

  it('uses canonical object equality and fails closed for ambiguous positional arrays', () => {
    const base = { options: [{ label: 'A' }, { label: 'B' }], config: { a: 1, b: 2 } }
    const applied = { options: [{ label: 'A+' }, { label: 'B' }], config: { b: 2, a: 1 } }

    expect(
      safeAgentUndo(base, applied, { options: [{ label: 'Later' }, { label: 'B' }], config: { a: 1, b: 2 } }),
    ).toEqual({
      ok: false,
      conflictPaths: ['/options'],
    })
  })

  it('fails closed when an inserted keyed item was edited later', () => {
    const base = { components: [] as Array<{ id: string; value: number }> }
    const applied = { components: [{ id: 'task', value: 1 }] }
    const current = { components: [{ id: 'task', value: 2 }] }

    expect(safeAgentUndo(base, applied, current)).toEqual({
      ok: false,
      conflictPaths: ['/components/@id=task'],
    })
  })
})
