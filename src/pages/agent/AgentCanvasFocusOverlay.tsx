import { ScanLine } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { AgentCanvasActivity } from './agent-canvas-focus'

export function AgentCanvasFocusOverlay({ activity }: { activity: AgentCanvasActivity }) {
  const reduceMotion = useReducedMotion()

  return (
    <div className='pointer-events-none absolute inset-0 z-30 overflow-hidden' aria-hidden='true'>
      {activity.targets.length === 0 ? (
        <motion.div
          data-agent-canvas-focus='current-area'
          className='absolute inset-3 border border-[var(--ed-cyan)]/45 bg-[linear-gradient(180deg,rgb(103_198_217/0.035),transparent_18%)]'
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.24 }}
        >
          <span className='absolute left-3 top-3 flex h-7 max-w-[320px] items-center gap-1.5 border border-[var(--ed-cyan)]/35 bg-[var(--ed-panel)]/95 px-2.5 text-[11px] font-medium text-[var(--ed-ink-soft)]'>
            <ScanLine className='size-3.5 shrink-0 text-[var(--ed-cyan)]' />
            <span className='truncate'>Agent 正在处理 · {activity.label}</span>
          </span>
          {reduceMotion ? null : (
            <motion.span
              className='absolute inset-y-0 left-0 w-px bg-[linear-gradient(180deg,transparent,var(--ed-cyan),transparent)]'
              animate={{ x: [0, 'calc(100vw - 32px)', 0] }}
              transition={{ duration: 3.2, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
            />
          )}
        </motion.div>
      ) : null}
      {activity.targets.map(target => (
        <motion.div
          key={target.id}
          data-agent-canvas-focus={target.id}
          className='absolute border border-[var(--ed-cyan)] shadow-[0_0_0_1px_rgb(103_198_217/0.22),inset_0_0_26px_rgb(103_198_217/0.08)]'
          style={{
            left: target.rect.x,
            top: target.rect.y,
            width: target.rect.width,
            height: target.rect.height,
          }}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className='absolute -left-px -top-7 flex h-6 max-w-[260px] items-center gap-1.5 bg-[var(--ed-cyan)] px-2 text-[10px] font-medium text-[#041014] shadow-[0_6px_18px_rgb(0_0_0/0.32)]'>
            <ScanLine className='size-3 shrink-0' />
            <span className='truncate'>Agent 正在更新 · {target.label}</span>
          </span>
          {reduceMotion ? null : (
            <motion.span
              className='absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--ed-cyan),transparent)] shadow-[0_0_12px_var(--ed-cyan)]'
              animate={{ y: [0, Math.max(0, target.rect.height - 2), 0] }}
              transition={{ duration: 2.2, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
            />
          )}
          <span className='absolute -left-px -top-px size-2 border-l-2 border-t-2 border-white' />
          <span className='absolute -right-px -top-px size-2 border-r-2 border-t-2 border-white' />
          <span className='absolute -bottom-px -left-px size-2 border-b-2 border-l-2 border-white' />
          <span className='absolute -bottom-px -right-px size-2 border-b-2 border-r-2 border-white' />
        </motion.div>
      ))}
    </div>
  )
}
