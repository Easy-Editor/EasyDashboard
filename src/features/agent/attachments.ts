export const AGENT_REFERENCE_ATTACHMENT_ACCEPT =
  '.png,.jpg,.jpeg,.webp,.svg,.pdf,image/png,image/jpeg,image/webp,image/svg+xml,application/pdf'

export const AGENT_DATA_ATTACHMENT_ACCEPT =
  '.pdf,.txt,.md,.csv,.xlsx,application/pdf,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const AGENT_ATTACHMENT_ACCEPT = `${AGENT_REFERENCE_ATTACHMENT_ACCEPT},${AGENT_DATA_ATTACHMENT_ACCEPT}`

export const AGENT_ATTACHMENT_FORMAT_LABEL = 'PNG、JPG、WebP、SVG、PDF、TXT、Markdown、CSV、XLSX'

const CONTENT_TYPE_BY_EXTENSION = new Map<string, string>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
  ['pdf', 'application/pdf'],
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['csv', 'text/csv'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
])

const SUPPORTED_CONTENT_TYPES = new Set<string>(CONTENT_TYPE_BY_EXTENSION.values())

function fileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function agentAttachmentContentType(file: Pick<File, 'name' | 'type'>): string | null {
  if (SUPPORTED_CONTENT_TYPES.has(file.type)) return file.type
  return CONTENT_TYPE_BY_EXTENSION.get(fileExtension(file.name)) ?? null
}

export function isSupportedAgentAttachment(file: Pick<File, 'name' | 'type'>): boolean {
  return agentAttachmentContentType(file) !== null
}
