import type { AgentConversation } from '@/features/agent'
import { LockKeyhole, MessageSquareText, Plus } from 'lucide-react'
import { formatCompactTime } from './project-agent-model'

export function ConversationSidebar({
  activeConversationId,
  conversations,
  onCreate,
  onSelect,
  compact = false,
}: {
  activeConversationId?: string
  conversations: AgentConversation[]
  onCreate: () => void
  onSelect: (conversationId: string) => void
  compact?: boolean
}) {
  return (
    <aside
      aria-label='项目内私有对话'
      className={
        compact
          ? 'flex h-full min-h-0 flex-col bg-[var(--ed-rail)]'
          : 'flex min-h-0 w-[248px] shrink-0 flex-col border-r border-[var(--ed-line)] bg-[var(--ed-rail)] max-[1279px]:hidden'
      }
    >
      <div className='flex h-12 shrink-0 items-center justify-between border-b border-[var(--ed-line)] px-3'>
        <div>
          <p className='text-xs font-medium text-[var(--ed-ink)]'>我的对话</p>
          <p className='mt-0.5 flex items-center gap-1 text-[10px] text-[var(--ed-ink-faint)]'>
            <LockKeyhole className='size-2.5' aria-hidden='true' />
            仅你可见
          </p>
        </div>
        <button
          type='button'
          aria-label='新建对话'
          title='新建对话'
          onClick={onCreate}
          className='grid size-7 place-items-center rounded-[5px] border border-[var(--ed-line)] text-[var(--ed-ink-muted)] transition-colors hover:border-[var(--ed-line-strong)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
        >
          <Plus className='size-3.5' aria-hidden='true' />
        </button>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto p-2'>
        {conversations.length > 0 ? (
          <ul className='space-y-1'>
            {conversations.map(conversation => {
              const isActive = conversation.id === activeConversationId
              return (
                <li key={conversation.id}>
                  <button
                    type='button'
                    onClick={() => onSelect(conversation.id)}
                    className={`group relative w-full rounded-[6px] border px-2.5 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)] ${
                      isActive
                        ? 'border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)]'
                        : 'border-transparent hover:border-[var(--ed-line)] hover:bg-[var(--ed-panel)]'
                    }`}
                  >
                    {isActive ? (
                      <span className='absolute inset-y-2 left-0 w-0.5 bg-[var(--ed-cyan)]' aria-hidden='true' />
                    ) : null}
                    <span className='flex items-start gap-2'>
                      <MessageSquareText
                        className={`mt-0.5 size-3.5 shrink-0 ${
                          isActive ? 'text-[var(--ed-cyan)]' : 'text-[var(--ed-ink-faint)]'
                        }`}
                        aria-hidden='true'
                      />
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate text-[11px] font-medium text-[var(--ed-ink-soft)]'>
                          {conversation.title}
                        </span>
                        <span className='mt-1 flex items-center justify-between gap-2 font-mono text-[9px] text-[var(--ed-ink-faint)]'>
                          <span>{conversation.messages.length} 条消息</span>
                          <span>{formatCompactTime(conversation.updatedAt)}</span>
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className='border border-dashed border-[var(--ed-line-strong)] px-3 py-5 text-center'>
            <MessageSquareText className='mx-auto size-4 text-[var(--ed-ink-faint)]' aria-hidden='true' />
            <p className='mt-2 text-[11px] text-[var(--ed-ink-muted)]'>这个项目还没有对话</p>
            <button
              type='button'
              onClick={onCreate}
              className='mt-3 h-7 rounded-[6px] bg-[var(--ed-ink)] px-3 text-[10px] font-medium text-[var(--ed-canvas)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              新建对话
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
