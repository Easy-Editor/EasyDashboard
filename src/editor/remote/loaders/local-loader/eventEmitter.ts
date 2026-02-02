/**
 * 简单的事件发射器
 */
export class EventEmitter {
  private events = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, handler: (...args: unknown[]) => void): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set())
    }
    this.events.get(event)!.add(handler)
    return () => this.off(event, handler)
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.events.get(event)?.delete(handler)
  }

  emit(event: string, ...args: unknown[]): void {
    this.events.get(event)?.forEach(handler => {
      try {
        handler(...args)
      } catch (error) {
        console.error(`[LocalMaterialLoader] Event handler error (${event}):`, error)
      }
    })
  }
}
