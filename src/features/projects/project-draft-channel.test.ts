import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_DRAFT_CHANNEL, publishProjectDraftUpdate, subscribeProjectDraftUpdates } from './project-draft-channel'

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []

  readonly name: string
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()

  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.push(this)
  }
}

describe('project draft update channel', () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel

  afterEach(() => {
    FakeBroadcastChannel.instances = []
    globalThis.BroadcastChannel = originalBroadcastChannel
  })

  it('publishes a versioned project update and closes the short-lived channel', () => {
    globalThis.BroadcastChannel = FakeBroadcastChannel as unknown as typeof BroadcastChannel

    publishProjectDraftUpdate({ projectId: 'project-a', draftVersion: 20 })

    const channel = FakeBroadcastChannel.instances[0]!
    expect(channel.name).toBe(PROJECT_DRAFT_CHANNEL)
    expect(channel.postMessage).toHaveBeenCalledWith({ projectId: 'project-a', draftVersion: 20 })
    expect(channel.close).toHaveBeenCalledOnce()
  })

  it('delivers only valid updates for the subscribed project', () => {
    globalThis.BroadcastChannel = FakeBroadcastChannel as unknown as typeof BroadcastChannel
    const listener = vi.fn()
    const unsubscribe = subscribeProjectDraftUpdates('project-a', listener)
    const channel = FakeBroadcastChannel.instances[0]!

    channel.onmessage?.({ data: { projectId: 'project-b', draftVersion: 2 } } as MessageEvent)
    channel.onmessage?.({ data: { projectId: 'project-a', draftVersion: 3.5 } } as MessageEvent)
    channel.onmessage?.({ data: { projectId: 'project-a', draftVersion: 3 } } as MessageEvent)

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({ projectId: 'project-a', draftVersion: 3 })
    unsubscribe()
    expect(channel.close).toHaveBeenCalledOnce()
  })
})
