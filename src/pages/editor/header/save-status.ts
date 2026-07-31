import type { DraftSyncStatus } from '@/editor/persistence/draft-sync'

type SaveStatusInput = {
  status: DraftSyncStatus
  savedAt: string | null
}

const defaultTimeFormatter = (date: Date) =>
  new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)

export function formatEditorSaveStatus(
  input: SaveStatusInput,
  formatTime: (date: Date) => string = defaultTimeFormatter,
): string {
  if (input.status === 'dirty') return '有未保存更改'
  if (input.status === 'saving') return '保存中…'
  if (input.status === 'error') return '保存失败'
  if (input.status === 'conflict') return '版本冲突'

  if (!input.savedAt) return '已保存'
  const date = new Date(input.savedAt)
  if (Number.isNaN(date.getTime())) return '已保存'
  return `已保存 · ${formatTime(date)}`
}
