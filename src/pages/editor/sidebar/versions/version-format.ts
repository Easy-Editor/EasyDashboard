import type { ProjectRevision } from '@/api/contracts'

const revisionKindLabels: Record<ProjectRevision['kind'], string> = {
  auto: '自动保存',
  manual: '手动备份',
  pre_restore: '恢复前备份',
  publish: '发布版本',
  agent: 'Agent 执行前',
}

const defaultDateFormatter = (date: Date) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)

export function formatRevisionKind(kind: ProjectRevision['kind']): string {
  return revisionKindLabels[kind]
}

export function formatRevisionTime(
  createdAt: string,
  formatDate: (date: Date) => string = defaultDateFormatter,
): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return formatDate(date)
}
