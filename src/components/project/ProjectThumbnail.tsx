import type { ProjectSummary } from '@/api/contracts'
import { cn } from '@/lib/utils'
import { ImageOff } from 'lucide-react'
import { useState } from 'react'

type ProjectWithArtwork = ProjectSummary & {
  coverUrl?: string | null
  thumbnailUrl?: string | null
}

type ProjectThumbnailProps = {
  project: ProjectWithArtwork
  className?: string
}

function projectSignal(projectId: string): number {
  return Array.from(projectId).reduce((total, character) => total + character.charCodeAt(0), 0) % 3
}

export function ProjectThumbnail({ project, className }: ProjectThumbnailProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const artworkUrl = project.thumbnail?.url ?? project.coverUrl ?? project.thumbnailUrl
  const signal = projectSignal(project.id)

  return (
    <div className={cn('ed-project-thumbnail relative isolate aspect-video overflow-hidden', className)}>
      {artworkUrl && !imageFailed ? (
        <img
          src={artworkUrl}
          alt=''
          className='absolute inset-0 size-full object-cover transition-transform duration-500 ease-out group-hover/card:scale-[1.018] motion-reduce:transition-none'
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className='absolute inset-0 overflow-hidden bg-[#080d16]'>
          <div className='ed-thumbnail-grid absolute inset-0 opacity-60' />
          <div
            className={cn(
              'absolute h-px bg-gradient-to-r from-transparent via-[var(--ed-cyan)] to-transparent opacity-80',
              signal === 0 && 'left-[12%] right-[8%] top-[34%]',
              signal === 1 && 'left-[8%] right-[18%] top-[58%]',
              signal === 2 && 'left-[18%] right-[10%] top-[43%]',
            )}
          />
          <div className='absolute bottom-[18%] left-[10%] right-[10%] flex items-end gap-[3px] opacity-75'>
            {[30, 52, 38, 74, 46, 66, 88, 58, 70, 42, 78, 54].map((height, index) => (
              <span
                // The repeated bars deliberately form a stable generated preview.
                key={`${height}-${index}`}
                className='flex-1 border-t border-[var(--ed-blue)] bg-[color-mix(in_srgb,var(--ed-blue)_14%,transparent)]'
                style={{ height: `${height * 0.44}%` }}
              />
            ))}
          </div>
          <div className='absolute left-[10%] top-[14%] flex items-center gap-2 text-[9px] uppercase tracking-[0.16em] text-[#668099]'>
            <span className='size-1 bg-[var(--ed-cyan)] shadow-[0_0_8px_var(--ed-cyan)]' />
            Live canvas
          </div>
        </div>
      )}
      <div className='absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-[#05080d]/92 via-[#05080d]/45 to-transparent px-3 pb-2.5 pt-8'>
        <span className='font-mono text-[9px] tracking-[0.08em] text-[#a0afbd]'>
          {project.resolution.width} × {project.resolution.height}
        </span>
        {artworkUrl && imageFailed ? <ImageOff className='size-3 text-[#687989]' aria-label='缩略图加载失败' /> : null}
      </div>
    </div>
  )
}
