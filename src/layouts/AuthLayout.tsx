import { BrandMark } from '@/components/brand/BrandMark'
import { BarChart3, Database, Image, Play, Redo2, Type, Undo2 } from 'lucide-react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Outlet } from 'react-router'

const PREVIEW_BARS = [44, 62, 54, 78, 68, 88, 73, 94, 82, 90]

function DashboardEditorPreview() {
  return (
    <div className='ed-auth-editor-preview'>
      <div className='ed-auth-editor-topbar'>
        <div>
          <strong>我的运营大屏</strong>
          <span>首页</span>
        </div>
        <div className='ed-auth-editor-actions'>
          <Undo2 />
          <Redo2 />
          <span />
          <Play />
        </div>
      </div>

      <div className='ed-auth-editor-rail'>
        <Type />
        <BarChart3 className='is-active' />
        <Database />
        <Image />
      </div>

      <div className='ed-auth-editor-workspace'>
        <div className='ed-auth-editor-ruler-x'>
          {Array.from({ length: 18 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
        <div className='ed-auth-editor-ruler-y'>
          {Array.from({ length: 10 }, (_, index) => (
            <i key={index} />
          ))}
        </div>

        <div className='ed-auth-editor-canvas'>
          <header>
            <div>
              <span />
              <span />
            </div>
            <i />
          </header>

          <div className='ed-auth-editor-metrics'>
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index}>
                <span />
                <strong />
              </div>
            ))}
          </div>

          <section className='ed-auth-editor-selected'>
            <b>趋势组件</b>
            <div className='ed-auth-editor-chart'>
              {PREVIEW_BARS.map((height, index) => (
                <i key={`${height}-${index}`} style={{ height: `${height}%` }} />
              ))}
            </div>
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index} />
            ))}
          </section>

          <section className='ed-auth-editor-map'>
            <div className='ed-auth-editor-orbit'>
              <i />
              <i />
              <i />
              <i />
            </div>
            <span />
            <span />
            <span />
          </section>
        </div>
      </div>
    </div>
  )
}

function CreatorCanvas() {
  const reduceMotion = useReducedMotion()
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [9, 4]), {
    stiffness: 110,
    damping: 24,
  })
  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [16, 9]), {
    stiffness: 110,
    damping: 24,
  })
  const lightX = useSpring(useTransform(pointerX, [-0.5, 0.5], [-24, 24]), {
    stiffness: 84,
    damping: 26,
  })

  function updatePointer(event: ReactPointerEvent<HTMLElement>) {
    if (reduceMotion) return
    const bounds = event.currentTarget.getBoundingClientRect()
    pointerX.set((event.clientX - bounds.left) / bounds.width - 0.5)
    pointerY.set((event.clientY - bounds.top) / bounds.height - 0.5)
  }

  function resetPointer() {
    pointerX.set(0)
    pointerY.set(0)
  }

  return (
    <motion.figure
      className='ed-auth-stage'
      aria-label='拟 3D 大屏创作画布'
      onPointerMove={updatePointer}
      onPointerLeave={resetPointer}
      initial={reduceMotion ? false : { opacity: 0, y: 28, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.78, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div className='ed-auth-stage-light' style={reduceMotion ? undefined : { x: lightX }} />
      <div className='ed-auth-stage-shadow' />
      <motion.div className='ed-auth-device' style={reduceMotion ? undefined : { rotateX, rotateY, rotateZ: 1.2 }}>
        <div className='ed-auth-page-layer ed-auth-page-layer-back' />
        <div className='ed-auth-page-layer ed-auth-page-layer-middle' />
        <div className='ed-auth-device-frame'>
          <div className='ed-auth-device-screen'>
            <DashboardEditorPreview />
            <motion.span className='ed-auth-device-reflection' style={reduceMotion ? undefined : { x: lightX }} />
          </div>
          <div className='ed-auth-device-meta'>
            <span>项目画布</span>
            <span>1920 × 1080</span>
          </div>
        </div>
      </motion.div>
    </motion.figure>
  )
}

export function AuthLayout() {
  return (
    <main data-ed-shell='auth' className='ed-auth-shell min-h-[100dvh] text-[var(--ed-ink)]'>
      <div className='ed-auth-layout mx-auto grid min-h-[100dvh] w-full'>
        <section className='ed-auth-showcase relative min-h-0 overflow-hidden' aria-labelledby='auth-product-message'>
          <div className='ed-auth-brand relative'>
            <BrandMark />
          </div>

          <div className='ed-auth-story relative'>
            <div className='ed-auth-copy'>
              <h2 id='auth-product-message' className='ed-auth-headline font-[var(--font-display)]'>
                让每一块大屏，
                <span>都有自己的样子。</span>
              </h2>
              <p className='ed-auth-description'>从页面、数据到交互效果，边搭建边预览，随时发布你的作品。</p>
            </div>
            <CreatorCanvas />
          </div>
        </section>

        <section className='ed-auth-control-wall relative flex min-h-0 items-center justify-center'>
          <div className='ed-auth-control-inner w-full max-w-[420px]'>
            <Outlet />
          </div>
        </section>
      </div>
    </main>
  )
}
