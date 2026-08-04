type PreviewNavigationRequest = {
  load: () => Promise<void>
  commit: () => void
}

export function createLatestPreviewNavigationRunner() {
  let generation = 0

  return {
    invalidate() {
      generation += 1
    },

    async run({ load, commit }: PreviewNavigationRequest): Promise<boolean> {
      const requestGeneration = ++generation

      try {
        await load()
      } catch (error) {
        if (requestGeneration !== generation) return false
        throw error
      }

      if (requestGeneration !== generation) return false
      commit()
      return true
    },
  }
}
