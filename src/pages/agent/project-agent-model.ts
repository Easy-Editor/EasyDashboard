import type {
  AgentAttachmentInput,
  AgentAttachmentScope,
  AgentConversation,
  AgentFileSelection,
  AgentTask,
} from '@/features/agent'
import { agentAttachmentContentType, isSupportedAgentAttachment } from '@/features/agent'

export type AttachmentDraft = AgentAttachmentInput & {
  clientId: string
  file?: File
}

export function resolveActiveConversation(
  conversations: AgentConversation[],
  requestedConversationId?: string,
): AgentConversation | null {
  if (requestedConversationId) {
    const requested = conversations.find(conversation => conversation.id === requestedConversationId)
    if (requested) return requested
  }

  return conversations.reduce<AgentConversation | null>((latest, conversation) => {
    if (!latest) return conversation
    return Date.parse(conversation.updatedAt) > Date.parse(latest.updatedAt) ? conversation : latest
  }, null)
}

export function createAttachmentDrafts(
  files: Iterable<Pick<File, 'name' | 'size' | 'type'>>,
  scope: AgentAttachmentScope,
): AttachmentDraft[] {
  return Array.from(files).flatMap(file => {
    const mimeType = agentAttachmentContentType(file)
    if (!mimeType || !isSupportedAgentAttachment(file)) return []
    return [
      {
        clientId: crypto.randomUUID(),
        name: file.name,
        mimeType,
        size: file.size,
        scope,
        ...(typeof File !== 'undefined' && file instanceof File ? { file } : {}),
      },
    ]
  })
}

export function toAttachmentInputs(drafts: AttachmentDraft[]): AgentAttachmentInput[] {
  return drafts.map(({ clientId: _clientId, file: _file, ...attachment }) => attachment)
}

export function toAgentFileSelections(drafts: AttachmentDraft[]): AgentFileSelection[] {
  return drafts.flatMap(draft =>
    draft.file ? [{ file: draft.file, scope: draft.scope, idempotencyKey: draft.clientId }] : [],
  )
}

export function describeTask(task: AgentTask | undefined): {
  label: string
  detail: string
  tone: 'waiting' | 'running' | 'complete' | 'failed'
} {
  if (!task || task.status === 'waiting') {
    return {
      label: '等待中',
      detail: '等待 Agent 开始处理',
      tone: 'waiting',
    }
  }
  if (task.status === 'running') {
    return {
      label: '执行中',
      detail: 'Agent 正在处理当前阶段',
      tone: 'running',
    }
  }
  if (task.status === 'complete') {
    return {
      label: '已完成',
      detail: '任务阶段已完成',
      tone: 'complete',
    }
  }
  return {
    label: '执行失败',
    detail: '任务未完成，请查看阶段详情',
    tone: 'failed',
  }
}

export function formatCompactTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
