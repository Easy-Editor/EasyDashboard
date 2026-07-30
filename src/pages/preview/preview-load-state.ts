export type PreviewLoadState<T> =
  | { status: 'loading'; canRetry: true }
  | { status: 'error'; error: Error; canRetry: true }
  | { status: 'ready'; project: T; canRetry: false }

export function resolvePreviewLoadState<T>(project: T | null, error: Error | null): PreviewLoadState<T> {
  if (error) {
    return {
      status: 'error',
      error,
      canRetry: true,
    }
  }

  if (!project) {
    return {
      status: 'loading',
      canRetry: true,
    }
  }

  return {
    status: 'ready',
    project,
    canRetry: false,
  }
}
