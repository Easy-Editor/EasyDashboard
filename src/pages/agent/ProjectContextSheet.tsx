import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { AgentProjectContext } from '@/features/agent'
import { BookCheck, Check, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

type ContextDraft = {
  id?: string
  title: string
  content: string
}

const EMPTY_DRAFT: ContextDraft = { title: '', content: '' }

export function ProjectContextSheet({
  contexts,
  open,
  onOpenChange,
  onConfirm,
  onDelete,
  onRollback,
  onSave,
}: {
  contexts: AgentProjectContext[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (contextId: string) => void
  onDelete: (contextId: string) => void
  onRollback: (contextId: string) => void
  onSave: (draft: ContextDraft) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<ContextDraft | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) setDraft(null)
  }, [open])

  const saveDraft = async () => {
    if (!draft?.title.trim() || !draft.content.trim()) return
    setSaving(true)
    try {
      const saved = await onSave({
        ...draft,
        title: draft.title.trim(),
        content: draft.content.trim(),
      })
      if (saved) setDraft(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-ed-shell='agent-context'
        className='w-[440px] max-w-[440px] gap-0 border-[var(--ed-line-strong)] bg-[var(--ed-panel)] p-0 text-[var(--ed-ink)]'
      >
        <SheetHeader className='border-b border-[var(--ed-line)] px-5 py-4'>
          <SheetTitle className='text-sm text-[var(--ed-ink)]'>项目上下文</SheetTitle>
          <SheetDescription className='text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
            待确认内容仅你可见；确认后会纳入这个项目的 Agent 上下文。
          </SheetDescription>
        </SheetHeader>

        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <div className='flex items-center justify-between border-b border-[var(--ed-line)] px-5 py-3'>
            <div className='flex items-center gap-3 text-[10px] text-[var(--ed-ink-faint)]'>
              <span>{contexts.filter(context => context.status === 'pending').length} 条待确认</span>
              <span>{contexts.filter(context => context.status === 'confirmed').length} 条已确认</span>
            </div>
            <button
              type='button'
              onClick={() => setDraft(EMPTY_DRAFT)}
              className='flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--ed-line-strong)] px-2.5 text-[10px] text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              <Plus className='size-3' aria-hidden='true' />
              新增
            </button>
          </div>

          {draft ? (
            <div className='border-b border-[var(--ed-line)] bg-[var(--ed-rail)] px-5 py-4'>
              <label className='block text-[10px] text-[var(--ed-ink-muted)]'>
                标题
                <input
                  value={draft.title}
                  onChange={event => setDraft(current => ({ ...(current ?? EMPTY_DRAFT), title: event.target.value }))}
                  className='mt-1.5 h-8 w-full rounded-[6px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-2.5 text-xs text-[var(--ed-ink)] outline-none placeholder:text-[var(--ed-ink-faint)] focus:border-[var(--ed-cyan)]'
                  placeholder='例如：视觉约束'
                />
              </label>
              <label className='mt-3 block text-[10px] text-[var(--ed-ink-muted)]'>
                内容
                <textarea
                  value={draft.content}
                  onChange={event =>
                    setDraft(current => ({ ...(current ?? EMPTY_DRAFT), content: event.target.value }))
                  }
                  className='mt-1.5 min-h-24 w-full resize-y rounded-[6px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-2.5 py-2 text-xs leading-5 text-[var(--ed-ink)] outline-none placeholder:text-[var(--ed-ink-faint)] focus:border-[var(--ed-cyan)]'
                  placeholder='记录可复用的项目目标、约束或决策'
                />
              </label>
              <div className='mt-3 flex justify-end gap-2'>
                <button
                  type='button'
                  onClick={() => setDraft(null)}
                  className='h-7 rounded-[6px] px-2.5 text-[10px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)]'
                >
                  取消
                </button>
                <button
                  type='button'
                  disabled={saving || !draft.title.trim() || !draft.content.trim()}
                  onClick={() => void saveDraft()}
                  className='h-7 rounded-[6px] bg-[var(--ed-ink)] px-3 text-[10px] font-medium text-[var(--ed-canvas)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40'
                >
                  {saving ? '保存中…' : draft.id ? '保存修改' : '保存为待确认'}
                </button>
              </div>
            </div>
          ) : null}

          <div className='min-h-0 flex-1 overflow-y-auto px-5 py-4'>
            {contexts.length > 0 ? (
              <ul className='space-y-2'>
                {contexts.map(context => (
                  <li
                    key={context.id}
                    className='rounded-[7px] border border-[var(--ed-line)] bg-[var(--ed-rail)] px-3 py-3'
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <div className='flex items-center gap-2'>
                          <p className='truncate text-[11px] font-medium text-[var(--ed-ink)]'>{context.title}</p>
                          <span className='font-mono text-[8px] text-[var(--ed-ink-faint)]'>v{context.revision}</span>
                          <span
                            className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] ${
                              context.status === 'confirmed'
                                ? 'border-[color-mix(in_srgb,var(--ed-success)_45%,var(--ed-line))] text-[var(--ed-success)]'
                                : 'border-[color-mix(in_srgb,var(--ed-warning)_45%,var(--ed-line))] text-[var(--ed-warning)]'
                            }`}
                          >
                            {context.status === 'confirmed' ? '已确认' : '待确认'}
                          </span>
                        </div>
                        <p className='mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
                          {context.content}
                        </p>
                      </div>
                    </div>
                    <div className='mt-3 flex items-center gap-1 border-t border-[var(--ed-line)] pt-2'>
                      {context.status === 'pending' ? (
                        <button
                          type='button'
                          onClick={() => onConfirm(context.id)}
                          className='flex h-6 items-center gap-1 rounded-[5px] px-2 text-[9px] text-[var(--ed-success)] hover:bg-[var(--ed-panel-raised)]'
                        >
                          <BookCheck className='size-3' aria-hidden='true' />
                          确认使用
                        </button>
                      ) : (
                        <span className='flex h-6 items-center gap-1 px-2 text-[9px] text-[var(--ed-success)]'>
                          <Check className='size-3' aria-hidden='true' />
                          已进入项目上下文
                        </span>
                      )}
                      <button
                        type='button'
                        aria-label={`回滚${context.title}到上一版`}
                        disabled={context.history.length === 0}
                        onClick={() => onRollback(context.id)}
                        className='grid size-6 place-items-center rounded-[5px] text-[var(--ed-ink-faint)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-cyan)] disabled:cursor-not-allowed disabled:opacity-30'
                      >
                        <RotateCcw className='size-3' aria-hidden='true' />
                      </button>
                      <button
                        type='button'
                        aria-label={`编辑${context.title}`}
                        onClick={() => setDraft({ id: context.id, title: context.title, content: context.content })}
                        className='ml-auto grid size-6 place-items-center rounded-[5px] text-[var(--ed-ink-faint)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
                      >
                        <Pencil className='size-3' aria-hidden='true' />
                      </button>
                      <button
                        type='button'
                        aria-label={`删除${context.title}`}
                        onClick={() => onDelete(context.id)}
                        className='grid size-6 place-items-center rounded-[5px] text-[var(--ed-ink-faint)] hover:bg-[color-mix(in_srgb,var(--ed-error)_10%,transparent)] hover:text-[var(--ed-error)]'
                      >
                        <Trash2 className='size-3' aria-hidden='true' />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className='border border-dashed border-[var(--ed-line-strong)] px-5 py-8 text-center'>
                <p className='text-xs text-[var(--ed-ink-soft)]'>还没有项目上下文</p>
                <p className='mt-1.5 text-[10px] leading-5 text-[var(--ed-ink-faint)]'>
                  新增目标、约束或决策，先以待确认状态保存。
                </p>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
