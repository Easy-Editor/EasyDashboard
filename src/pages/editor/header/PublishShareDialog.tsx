import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getPublicViewerOrigin } from '@/features/projects/public-viewer'
import {
  type ProjectRelease,
  type PublishedProjectRelease,
  listProjectReleases,
  unpublishProjectRelease,
} from '@/features/releases/release-api'
import { Check, Clipboard, ExternalLink, Globe2, Loader2, Radio, ShieldOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

export const UNPUBLISH_CONFIRMATION =
  '取消发布后，稳定链接和所有版本链接都会立即失效并返回 404。保存或恢复草稿不会重新发布；如需再次公开，必须重新发布。'

export type PublishShareReleaseDetailsProps = {
  projectName: string
  releaseNumber: number
  publishedAt: string
  stableUrl: string
  versionUrl: string
  onCopy: (url: string, label: string) => void
  onOpen: (url: string) => void
}

function UrlRow({
  label,
  hint,
  url,
  onCopy,
  onOpen,
}: {
  label: string
  hint: string
  url: string
  onCopy: (url: string, label: string) => void
  onOpen: (url: string) => void
}) {
  return (
    <div className='border border-[var(--ed-line-strong)] bg-[var(--ed-rail)] p-3'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-[11px] font-medium text-[var(--ed-ink-soft)]'>{label}</p>
          <p className='mt-0.5 text-[10px] text-[var(--ed-ink-faint)]'>{hint}</p>
        </div>
        <div className='flex shrink-0 gap-1'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-7 text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
            aria-label={`复制${label}`}
            onClick={() => onCopy(url, label)}
          >
            <Clipboard className='size-3.5' />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-7 text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
            aria-label={`打开${label}`}
            onClick={() => onOpen(url)}
          >
            <ExternalLink className='size-3.5' />
          </Button>
        </div>
      </div>
      <p
        className='mt-2 truncate border-t border-[var(--ed-line)] pt-2 font-mono text-[10px] text-[var(--ed-cyan)]'
        title={url}
      >
        {url}
      </p>
    </div>
  )
}

export function PublishShareReleaseDetails({
  projectName,
  releaseNumber,
  publishedAt,
  stableUrl,
  versionUrl,
  onCopy,
  onOpen,
}: PublishShareReleaseDetailsProps) {
  return (
    <section aria-label={`${projectName} 的公开链接`} className='space-y-2'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2 text-[11px] text-[var(--ed-ink-muted)]'>
          <span className='inline-flex items-center gap-1.5 text-[#73D4A3]'>
            <span className='size-1.5 rounded-full bg-[#52D28B]' />
            已公开
          </span>
          <span className='text-[var(--ed-line-strong)]'>/</span>
          <span>版本 {releaseNumber}</span>
        </div>
        <time className='font-mono text-[10px] text-[var(--ed-ink-faint)]' dateTime={publishedAt}>
          {new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(publishedAt))}
        </time>
      </div>
      <UrlRow
        label='稳定链接（始终指向最新发布）'
        hint='适合嵌入大屏、发给长期访问者'
        url={stableUrl}
        onCopy={onCopy}
        onOpen={onOpen}
      />
      <UrlRow
        label='本次版本（发布后内容不会变化）'
        hint='适合验收、留档和精确引用'
        url={versionUrl}
        onCopy={onCopy}
        onOpen={onOpen}
      />
    </section>
  )
}

export type PublishShareDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
  initiallyPublished: boolean
  publish: () => Promise<PublishedProjectRelease>
  onPublicationChange?: (release: PublishedProjectRelease | null) => void
}

function viewerUrl(path: string | null): string | null {
  const origin = getPublicViewerOrigin()
  return path && origin ? new URL(path, `${origin}/`).toString() : null
}

export function PublishShareDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  initiallyPublished,
  publish,
  onPublicationChange,
}: PublishShareDialogProps) {
  const [releases, setReleases] = useState<ProjectRelease[]>([])
  const [loaded, setLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isUnpublishing, setIsUnpublishing] = useState(false)
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)

  const loadReleases = useCallback(async () => {
    setIsLoading(true)
    try {
      const history = await listProjectReleases(projectId)
      setReleases(history)
      setLoaded(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发布记录加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open && !loaded) void loadReleases()
  }, [loadReleases, loaded, open])

  const currentRelease = useMemo(
    () => releases.find(release => release.isCurrent && release.isPublished) ?? null,
    [releases],
  )
  const isPublished = currentRelease !== null || (!loaded && initiallyPublished)
  const stableUrl = viewerUrl(currentRelease?.stablePath ?? null)
  const versionUrl = viewerUrl(currentRelease?.versionPath ?? null)

  const copy = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(`${label}已复制`)
    } catch {
      toast.error('复制失败，请手动复制链接')
    }
  }

  const openUrl = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const publishCurrentDraft = async () => {
    setIsPublishing(true)
    try {
      const release = await publish()
      setReleases(current => [
        release,
        ...current
          .filter(item => item.releaseNumber !== release.releaseNumber)
          .map(item => ({ ...item, isCurrent: false, isPublished: true })),
      ])
      setLoaded(true)
      onPublicationChange?.(release)
      toast.success(`版本 ${release.releaseNumber} 已发布`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发布失败')
    } finally {
      setIsPublishing(false)
    }
  }

  const unpublish = async () => {
    setIsUnpublishing(true)
    try {
      await unpublishProjectRelease(projectId)
      setReleases(current => current.map(release => ({ ...release, isCurrent: false, isPublished: false })))
      onPublicationChange?.(null)
      setConfirmUnpublish(false)
      toast.success('已取消发布', {
        description: '所有公开链接现已失效',
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '取消发布失败')
    } finally {
      setIsUnpublishing(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          data-ed-shell='editor'
          className='max-h-[82vh] gap-0 overflow-hidden border-[var(--ed-line-strong)] bg-[var(--ed-panel)] p-0 text-[var(--ed-ink)] sm:max-w-[700px]'
        >
          <DialogHeader className='border-b border-[var(--ed-line)] bg-[var(--ed-panel-raised)]/55 px-5 py-4'>
            <div className='flex items-center gap-2'>
              <div className='grid size-8 place-items-center border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)]'>
                <Globe2 className='size-4 text-[var(--ed-cyan)]' />
              </div>
              <div>
                <DialogTitle className='text-sm'>发布与分享</DialogTitle>
                <DialogDescription className='mt-1 text-[11px] text-[var(--ed-ink-soft)]'>
                  发布大屏快照，并管理公开访问地址
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className='grid min-h-0 md:grid-cols-[minmax(0,1.25fr)_minmax(220px,0.75fr)]'>
            <div className='min-w-0 border-b border-[var(--ed-line)] p-5 md:border-r md:border-b-0'>
              {isLoading && !loaded ? (
                <div className='flex h-52 items-center justify-center gap-2 text-xs text-[var(--ed-ink-muted)]'>
                  <Loader2 className='size-4 animate-spin' />
                  正在读取发布状态
                </div>
              ) : currentRelease && stableUrl && versionUrl ? (
                <PublishShareReleaseDetails
                  projectName={projectName}
                  releaseNumber={currentRelease.releaseNumber}
                  publishedAt={currentRelease.publishedAt}
                  stableUrl={stableUrl}
                  versionUrl={versionUrl}
                  onCopy={(url, label) => void copy(url, label)}
                  onOpen={openUrl}
                />
              ) : isPublished ? (
                <div className='flex h-52 flex-col items-center justify-center border border-[var(--ed-line-strong)] bg-[var(--ed-rail)] px-6 text-center'>
                  <Loader2 className='size-4 animate-spin text-[var(--ed-cyan)]' />
                  <p className='mt-3 text-xs text-[var(--ed-ink-soft)]'>正在同步公开链接</p>
                </div>
              ) : (
                <div className='flex h-52 flex-col items-center justify-center border border-dashed border-[var(--ed-line-strong)] bg-[var(--ed-rail)] px-7 text-center'>
                  <div className='grid size-10 place-items-center rounded-full border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)]'>
                    <Radio className='size-4 text-[var(--ed-cyan)]' />
                  </div>
                  <p className='mt-3 text-sm font-medium text-[var(--ed-ink-soft)]'>这个大屏尚未公开</p>
                  <p className='mt-2 max-w-sm text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
                    发布会生成一个长期稳定链接，以及一个内容不可变的版本链接。
                  </p>
                </div>
              )}

              {getPublicViewerOrigin() ? null : (
                <p className='mt-3 border border-[#5B4327] bg-[#211A12] px-3 py-2 text-[10px] leading-4 text-[#D7B578]'>
                  未配置公开查看器地址，发布记录仍可管理，但暂时无法生成可分享链接。
                </p>
              )}
              <p className='mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-[var(--ed-ink-faint)]'>
                <Check className='mt-0.5 size-3 shrink-0 text-[#56B98A]' />
                保存和恢复只改变草稿，不会自动发布或重新公开；每次发布都需要明确操作。
              </p>
            </div>

            <div className='flex min-h-0 flex-col bg-[var(--ed-rail)]'>
              <div className='border-b border-[var(--ed-line)] px-4 py-3'>
                <p className='text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ed-ink-muted)]'>
                  发布历史
                </p>
              </div>
              <ScrollArea className='h-[260px] md:h-[330px]'>
                <div className='space-y-2 p-3'>
                  {releases.length === 0 ? (
                    <p className='px-2 py-8 text-center text-[11px] text-[var(--ed-ink-faint)]'>暂无发布记录</p>
                  ) : (
                    releases.map(release => {
                      const releaseUrl = release.isPublished ? viewerUrl(release.versionPath) : null
                      return (
                        <div
                          key={release.releaseNumber}
                          className='border border-[var(--ed-line)] bg-[var(--ed-panel)] px-3 py-2.5'
                        >
                          <div className='flex items-center justify-between gap-2'>
                            <span className='text-[11px] font-medium text-[var(--ed-ink-soft)]'>
                              版本 {release.releaseNumber}
                            </span>
                            {release.isCurrent && release.isPublished ? (
                              <span className='border border-[#28513F] bg-[#10241C] px-1.5 py-0.5 text-[9px] text-[#68C897]'>
                                当前
                              </span>
                            ) : null}
                          </div>
                          <div className='mt-1.5 flex items-center justify-between gap-2'>
                            <time
                              className='font-mono text-[9px] text-[var(--ed-ink-faint)]'
                              dateTime={release.publishedAt}
                            >
                              {new Intl.DateTimeFormat('zh-CN', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              }).format(new Date(release.publishedAt))}
                            </time>
                            {releaseUrl ? (
                              <button
                                type='button'
                                className='text-[10px] text-[var(--ed-cyan)] hover:text-[var(--ed-ink)]'
                                onClick={() => openUrl(releaseUrl)}
                              >
                                打开版本
                              </button>
                            ) : (
                              <span className='text-[9px] text-[var(--ed-ink-faint)]'>公开访问已关闭</span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          <DialogFooter className='flex-row items-center justify-between border-t border-[var(--ed-line)] bg-[var(--ed-rail)] px-5 py-3 sm:justify-between'>
            <div>
              {isPublished ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='h-8 gap-1.5 px-2 text-[11px] text-[#B78383] hover:bg-[#271718] hover:text-[#E3A0A0]'
                  disabled={isPublishing || isUnpublishing}
                  onClick={() => setConfirmUnpublish(true)}
                >
                  <ShieldOff className='size-3.5' />
                  取消发布
                </Button>
              ) : null}
            </div>
            <Button
              type='button'
              size='sm'
              className='h-8 gap-1.5 bg-[var(--ed-ink)] px-4 text-[11px] text-[var(--ed-canvas)] hover:bg-white'
              disabled={isPublishing || isUnpublishing}
              onClick={() => void publishCurrentDraft()}
            >
              {isPublishing ? <Loader2 className='size-3.5 animate-spin' /> : null}
              {isPublishing ? '正在发布' : isPublished ? '发布新版本' : '发布当前草稿'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmUnpublish} onOpenChange={setConfirmUnpublish}>
        <AlertDialogContent
          data-ed-shell='editor'
          className='border-[#3A2D2D] bg-[var(--ed-panel)] text-[var(--ed-ink)] sm:max-w-[430px]'
        >
          <AlertDialogHeader>
            <AlertDialogTitle className='text-base'>确认取消发布？</AlertDialogTitle>
            <AlertDialogDescription className='leading-6 text-[#A79595]'>
              {UNPUBLISH_CONFIRMATION}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isUnpublishing}
              className='border-[var(--ed-line-strong)] bg-transparent text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
            >
              保持发布
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isUnpublishing}
              className='bg-[#B84E55] text-white hover:bg-[#CB5C63]'
              onClick={event => {
                event.preventDefault()
                void unpublish()
              }}
            >
              {isUnpublishing ? <Loader2 className='size-4 animate-spin' /> : null}
              {isUnpublishing ? '正在取消' : '取消发布并使链接失效'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
