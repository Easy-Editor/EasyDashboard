import { type ProjectCardProject, formatProjectTime } from '@/components/project/ProjectCard'
import { ProjectThumbnail } from '@/components/project/ProjectThumbnail'
import { ArrowUpRight } from 'lucide-react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { type PointerEvent, useState } from 'react'
import { Link } from 'react-router'

const LAYOUT_BLOCKS = [
  { key: 'title', className: 'ed-home-core-wire-title' },
  { key: 'summary-a', className: 'ed-home-core-wire-summary-a' },
  { key: 'summary-b', className: 'ed-home-core-wire-summary-b' },
  { key: 'main', className: 'ed-home-core-wire-main' },
  { key: 'side-a', className: 'ed-home-core-wire-side-a' },
  { key: 'side-b', className: 'ed-home-core-wire-side-b' },
] as const

export type HomeLaunchCoreProps = {
  projectName: string
  promptReady: boolean
  attachmentCount: number
  attachmentScope: 'conversation' | 'project'
  creating: boolean
  recentProject: ProjectCardProject | null
  recentProjectHref: string | null
  projectsLoading: boolean
}

type ThumbnailState = {
  label: string
  shortLabel: string
  tone: 'ready' | 'busy' | 'failed' | 'placeholder'
}

function hasProjectArtwork(project: ProjectCardProject): boolean {
  return Boolean(project.thumbnail.url ?? project.coverUrl ?? project.thumbnailUrl)
}

export function getHomeThumbnailState(project: ProjectCardProject, artworkLoadFailed = false): ThumbnailState {
  const hasArtwork = hasProjectArtwork(project) && !artworkLoadFailed

  if (project.thumbnail.status === 'queued') {
    return hasArtwork
      ? { label: '新预览排队中 · 当前为上次结果', shortLabel: '预览待更新', tone: 'busy' }
      : { label: '预览排队中 · 当前为结构占位', shortLabel: '预览排队中', tone: 'busy' }
  }
  if (project.thumbnail.status === 'rendering') {
    return hasArtwork
      ? { label: '预览更新中 · 当前为上次结果', shortLabel: '预览更新中', tone: 'busy' }
      : { label: '预览生成中 · 当前为结构占位', shortLabel: '预览生成中', tone: 'busy' }
  }
  if (project.thumbnail.status === 'failed') {
    return hasArtwork
      ? { label: '预览更新失败 · 当前为上次结果', shortLabel: '预览更新失败', tone: 'failed' }
      : { label: '预览生成失败 · 当前为结构占位', shortLabel: '预览生成失败', tone: 'failed' }
  }
  return hasArtwork
    ? { label: '预览已同步', shortLabel: '预览已同步', tone: 'ready' }
    : { label: '暂无渲染图 · 当前为结构占位', shortLabel: '结构预览', tone: 'placeholder' }
}

export function HomeLaunchCore({
  projectName,
  promptReady,
  attachmentCount,
  attachmentScope,
  creating,
  recentProject,
  recentProjectHref,
  projectsLoading,
}: HomeLaunchCoreProps) {
  const [failedArtworkProjectId, setFailedArtworkProjectId] = useState<string | null>(null)
  const reduceMotion = useReducedMotion()
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [10.2, 5.8]), {
    stiffness: 110,
    damping: 24,
    mass: 0.9,
  })
  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [14.8, 21.2]), {
    stiffness: 110,
    damping: 24,
    mass: 0.9,
  })
  const lightX = useSpring(useTransform(pointerX, [-0.5, 0.5], [-24, 24]), {
    stiffness: 90,
    damping: 26,
  })
  const lightY = useSpring(useTransform(pointerY, [-0.5, 0.5], [-12, 12]), {
    stiffness: 90,
    damping: 26,
  })
  const shadowX = useSpring(useTransform(pointerX, [-0.5, 0.5], [9, -9]), {
    stiffness: 80,
    damping: 28,
  })
  const scopeLabel = attachmentScope === 'project' ? '项目文件' : '本次对话'
  const thumbnailState = recentProject
    ? getHomeThumbnailState(recentProject, failedArtworkProjectId === recentProject.id)
    : null
  const displayProjectName = recentProject?.name ?? (projectsLoading ? '正在读取工作区' : projectName)
  const statusLabel = recentProject
    ? `最近保存 · ${formatProjectTime(recentProject.savedAt)}`
    : projectsLoading
      ? '正在读取最近项目'
      : creating
        ? '正在创建项目'
        : promptReady
          ? '可以开始创建'
          : '等待项目目标'
  const projectStateLabel = recentProject?.state === 'published' ? '已发布' : '草稿'

  function updatePointer(event: PointerEvent<HTMLDivElement>) {
    if (reduceMotion) return
    const bounds = event.currentTarget.getBoundingClientRect()
    pointerX.set((event.clientX - bounds.left) / bounds.width - 0.5)
    pointerY.set((event.clientY - bounds.top) / bounds.height - 0.5)
  }

  function resetPointer() {
    pointerX.set(0)
    pointerY.set(0)
  }

  const scene = (
    <motion.div
      data-home-motion='launch-core'
      data-mode={recentProject ? 'recent-project' : projectsLoading ? 'loading' : 'creation'}
      data-ready={recentProject || promptReady ? 'true' : 'false'}
      data-creating={creating ? 'true' : 'false'}
      className='ed-home-core-scene relative aspect-[1.42] w-full touch-none'
      aria-hidden='true'
      onPointerMove={updatePointer}
      onPointerLeave={resetPointer}
    >
      <motion.div
        className='ed-home-core-light absolute left-[9%] top-[1%] h-[78%] w-[82%]'
        style={reduceMotion ? undefined : { x: lightX, y: lightY }}
      />
      <motion.div
        className='ed-home-core-shadow absolute bottom-[7%] left-[8%] h-[18%] w-[84%]'
        style={reduceMotion ? undefined : { x: shadowX }}
      />

      <motion.div
        className='absolute inset-0 [transform-style:preserve-3d]'
        initial={reduceMotion ? false : { opacity: 0.2, y: 30, scale: 0.95, rotateZ: 1.8 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotateZ: 0 }}
        transition={{ duration: 0.72, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div
          className='ed-home-core-device absolute left-[2.5%] top-[7%] h-[76%] w-[92%]'
          style={reduceMotion ? undefined : { rotateX, rotateY, rotateZ: -2 }}
        >
          <div className='ed-home-core-face ed-home-core-face-right'>
            <div className='ed-home-core-depth-groove' />
            <div className='ed-home-core-depth-vents'>
              {Array.from({ length: 4 }, (_, index) => (
                <i key={index} />
              ))}
            </div>
          </div>

          <div className='ed-home-core-face ed-home-core-face-bottom'>
            {recentProject ? (
              <>
                <div className='ed-home-core-project-pages'>
                  <span>页面</span>
                  <b>{recentProject.pageCount}</b>
                </div>
                <div className='ed-home-core-project-save'>
                  <span>{projectStateLabel}</span>
                  <b>{formatProjectTime(recentProject.savedAt)}</b>
                </div>
              </>
            ) : projectsLoading ? (
              <>
                <div className='ed-home-core-project-pages'>
                  <span>项目</span>
                  <b>读取中</b>
                </div>
                <div className='ed-home-core-project-save'>
                  <span>预览</span>
                  <b>同步中</b>
                </div>
              </>
            ) : (
              <>
                <div className='ed-home-core-attachment-bay'>
                  <span>资料</span>
                  <div>
                    {Array.from({ length: Math.min(attachmentCount, 3) }, (_, index) => (
                      <motion.i
                        key={`${attachmentCount}-${index}`}
                        initial={reduceMotion ? false : { x: -7, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ duration: 0.22, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
                      />
                    ))}
                    {attachmentCount === 0 ? <i className='is-empty' /> : null}
                  </div>
                  <b>{attachmentCount}</b>
                </div>
                <div className='ed-home-core-scope-switch' data-scope={attachmentScope}>
                  <span>{scopeLabel}</span>
                  <i>
                    <motion.b
                      animate={{ x: attachmentScope === 'project' ? 14 : 0 }}
                      transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </i>
                </div>
              </>
            )}
          </div>

          <section className='ed-home-core-face ed-home-core-face-front'>
            <div className='ed-home-core-top-rail'>
              <div className='min-w-0'>
                <p className='truncate'>{displayProjectName}</p>
                <span>{statusLabel}</span>
              </div>
            </div>

            <div className='ed-home-core-screen-well'>
              <motion.div
                className='ed-home-core-screen'
                animate={{ opacity: recentProject || promptReady || projectsLoading ? 1 : 0.64 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
              >
                {recentProject ? (
                  <ProjectThumbnail
                    project={recentProject}
                    className='ed-home-core-project-thumbnail absolute inset-0 size-full rounded-[4px]'
                    onArtworkLoadStateChange={state =>
                      setFailedArtworkProjectId(state === 'failed' ? recentProject.id : null)
                    }
                  />
                ) : (
                  <div className='ed-home-core-grid absolute inset-0' />
                )}
                <motion.div
                  className='ed-home-core-reflection absolute -inset-y-[18%] left-[43%] w-[17%] -skew-x-[18deg]'
                  style={reduceMotion ? undefined : { x: lightX }}
                />
                {recentProject ? (
                  <p className='ed-home-core-thumbnail-state' data-tone={thumbnailState?.tone}>
                    {thumbnailState?.label}
                  </p>
                ) : (
                  <>
                    <div className='ed-home-core-wireframe absolute inset-[8%]'>
                      {LAYOUT_BLOCKS.map((block, index) => (
                        <motion.span
                          key={block.key}
                          className={block.className}
                          animate={{
                            opacity: projectsLoading ? 0.38 : promptReady ? 0.74 : 0.2,
                            scale: promptReady ? 1 : 0.985,
                          }}
                          transition={{
                            duration: reduceMotion ? 0 : 0.22,
                            delay: promptReady ? index * 0.025 : 0,
                          }}
                        />
                      ))}
                    </div>
                    {promptReady ? null : (
                      <p className='ed-home-core-waiting'>{projectsLoading ? '正在读取最近项目' : '等待目标'}</p>
                    )}
                  </>
                )}
                <motion.div
                  className='ed-home-core-calibration-line'
                  animate={creating || projectsLoading ? { x: ['-120%', '170%'] } : { x: '-120%' }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.9,
                    ease: [0.16, 1, 0.3, 1],
                    repeat: projectsLoading && !reduceMotion ? Number.POSITIVE_INFINITY : 0,
                    repeatDelay: 0.45,
                  }}
                />
              </motion.div>
            </div>

            <div className='ed-home-core-bottom-rail'>
              {recentProject ? (
                <>
                  <span className='is-active'>
                    <i />
                    {recentProject.pageCount} 个页面
                  </span>
                  <span className={thumbnailState?.tone === 'failed' ? 'is-warning' : 'is-active'}>
                    <i />
                    {thumbnailState?.shortLabel}
                  </span>
                  <span className='ed-home-core-enter-cue is-active'>
                    继续项目
                    <ArrowUpRight />
                  </span>
                </>
              ) : (
                <>
                  <span className={promptReady ? 'is-active' : undefined}>
                    <i />
                    目标
                  </span>
                  <span className={attachmentCount > 0 ? 'is-active' : undefined}>
                    <i />
                    资料
                  </span>
                  <span className='is-active'>
                    <i />
                    画布
                  </span>
                </>
              )}
            </div>

            <motion.i
              className='ed-home-core-clamp ed-home-core-clamp-left'
              animate={{ x: creating ? 5 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.i
              className='ed-home-core-clamp ed-home-core-clamp-right'
              animate={{ x: creating ? -5 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
            />
          </section>
        </motion.div>
      </motion.div>
    </motion.div>
  )

  return (
    <aside className='ed-home-core-panel relative flex min-w-0 items-center justify-center overflow-hidden px-5 py-9 xl:px-6'>
      <output className='sr-only' aria-live='polite'>
        {recentProject
          ? `最近项目 ${recentProject.name}，${recentProject.pageCount} 个页面，${statusLabel}，${thumbnailState?.label}。`
          : projectsLoading
            ? '正在读取最近保存的项目。'
            : `${statusLabel}，${attachmentCount} 个附件，附件将保存到${scopeLabel}。`}
      </output>

      {recentProject && recentProjectHref ? (
        <Link
          to={recentProjectHref}
          aria-label={`继续项目 ${recentProject.name}`}
          data-home-recent-project={recentProject.id}
          className='ed-home-core-shell ed-home-core-project-link group/card relative block w-full rounded-[12px] outline-none'
        >
          {scene}
        </Link>
      ) : (
        <div className='ed-home-core-shell relative w-full'>{scene}</div>
      )}
    </aside>
  )
}
