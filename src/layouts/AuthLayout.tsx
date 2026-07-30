import { BrandMark } from '@/components/brand/BrandMark'
import { BarChart3, CircleDot, RadioTower } from 'lucide-react'
import { Outlet } from 'react-router'

function CanvasScene() {
  return (
    <div className='ed-auth-scene relative mx-auto aspect-[1.18] w-full max-w-[690px]' aria-hidden='true'>
      <div className='ed-auth-orbit absolute left-[12%] top-[4%] size-[72%] rounded-full border border-[#3c79ff]/10' />
      <div className='ed-auth-page ed-auth-page-back absolute left-[22%] top-[9%] h-[62%] w-[68%] rounded-[12px] border border-[#28415d] bg-[#0a1422] p-4'>
        <div className='flex items-center gap-1.5'>
          <span className='size-1.5 rounded-full bg-[#29405a]' />
          <span className='size-1.5 rounded-full bg-[#29405a]' />
          <span className='size-1.5 rounded-full bg-[#29405a]' />
        </div>
        <div className='mt-5 grid grid-cols-[1.15fr_.85fr] gap-3'>
          <div className='h-28 border border-[#20344a] bg-[#0c1928]' />
          <div className='space-y-2'>
            <div className='h-12 border border-[#20344a] bg-[#0c1928]' />
            <div className='h-12 border border-[#20344a] bg-[#0c1928]' />
          </div>
        </div>
      </div>

      <div className='ed-auth-page ed-auth-page-mid absolute left-[10%] top-[19%] h-[65%] w-[72%] rounded-[12px] border border-[#2b4664] bg-[#0a111c] p-4 shadow-2xl'>
        <div className='flex items-center justify-between border-b border-[#1e3044] pb-3'>
          <span className='font-mono text-[7px] tracking-[0.22em] text-[#6e89a4]'>ENERGY / NORTH</span>
          <span className='flex items-center gap-1 font-mono text-[7px] text-[#6ddcf3]'>
            <span className='size-1 rounded-full bg-[#6ddcf3] shadow-[0_0_8px_#6ddcf3]' />
            LIVE
          </span>
        </div>
        <div className='mt-4 grid grid-cols-[1.35fr_.65fr] gap-3'>
          <div className='relative h-36 overflow-hidden border border-[#20344a] bg-[#07111d]'>
            <div className='ed-auth-chart-grid absolute inset-0' />
            <svg className='absolute inset-0 size-full' viewBox='0 0 280 130' fill='none' aria-hidden='true'>
              <path
                d='M0 104 C32 108 42 72 73 78 C110 85 110 34 144 47 C174 59 182 22 210 28 C239 34 244 9 280 16'
                stroke='#4f8cff'
                strokeWidth='2'
              />
              <path
                d='M0 113 C38 102 48 108 79 94 C112 79 124 103 153 77 C180 54 197 73 226 48 C246 31 258 45 280 31'
                stroke='#6ddcf3'
                strokeWidth='1.25'
                opacity='.8'
              />
            </svg>
          </div>
          <div className='grid grid-rows-2 gap-3'>
            <div className='border border-[#20344a] bg-[#0c1928] p-3'>
              <RadioTower className='size-3 text-[#6ddcf3]' />
              <p className='mt-4 font-mono text-xl text-[#e7f2fa]'>98.4</p>
              <p className='mt-1 font-mono text-[7px] tracking-[0.16em] text-[#607991]'>STABILITY</p>
            </div>
            <div className='border border-[#20344a] bg-[#0c1928] p-3'>
              <BarChart3 className='size-3 text-[#4f8cff]' />
              <div className='mt-5 flex h-7 items-end gap-1'>
                {[38, 62, 46, 88, 56, 74, 100, 69].map(height => (
                  <span
                    key={height}
                    className='flex-1 border-t border-[#4f8cff] bg-[#4f8cff]/15'
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className='ed-auth-page ed-auth-page-front absolute bottom-[2%] right-[2%] h-[38%] w-[52%] rounded-[12px] border border-[#315175] bg-[#0d1827]/95 p-4 shadow-[0_30px_80px_rgba(0,0,0,.55)] backdrop-blur'>
        <div className='flex items-center justify-between'>
          <span className='font-mono text-[8px] tracking-[0.16em] text-[#7b94ad]'>PAGE 03</span>
          <CircleDot className='size-3 text-[#6ddcf3]' />
        </div>
        <p className='mt-5 font-[var(--font-display)] text-[11px] font-medium text-[#dbe9f3]'>城市脉搏实时监测</p>
        <div className='mt-3 h-px w-full bg-gradient-to-r from-[#4f8cff] via-[#6ddcf3] to-transparent' />
        <div className='mt-3 grid grid-cols-3 gap-1.5'>
          <span className='h-8 bg-[#14263a]' />
          <span className='h-8 bg-[#14263a]' />
          <span className='h-8 bg-[#14263a]' />
        </div>
      </div>
    </div>
  )
}

export function AuthLayout() {
  return (
    <main
      data-ed-shell='auth'
      className='min-h-screen min-w-[1024px] overflow-hidden bg-[var(--ed-canvas)] text-[var(--ed-ink)]'
    >
      <div className='grid min-h-screen grid-cols-[62fr_38fr]'>
        <section className='relative flex min-h-screen flex-col overflow-hidden border-r border-[var(--ed-line)] px-12 py-10 xl:px-16'>
          <div className='ed-auth-grid absolute inset-0' aria-hidden='true' />
          <div className='ed-auth-glow absolute -left-[18%] top-[16%] h-[64%] w-[82%] rounded-full bg-[#1e5eff]/10 blur-[100px]' />
          <div className='relative z-10'>
            <BrandMark />
          </div>
          <div className='relative z-10 my-auto grid min-h-0 grid-rows-[auto_1fr] gap-2 pt-10'>
            <div>
              <p className='font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ed-cyan)]'>
                Precision canvas system
              </p>
              <h2 className='mt-4 max-w-xl font-[var(--font-display)] text-[clamp(34px,3.4vw,58px)] leading-[1.08] font-medium tracking-[-0.04em] text-[#f0f7fc]'>
                让每一页数据
                <br />
                <span className='text-[#8598aa]'>都有准确的表达。</span>
              </h2>
            </div>
            <CanvasScene />
          </div>
          <div className='relative z-10 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-[#53677a]'>
            <span>EasyDashboard / Studio</span>
            <span>Canvas · Preview · Publish</span>
          </div>
        </section>

        <section className='relative flex min-h-screen items-center justify-center bg-[#090d13] px-[clamp(44px,5vw,88px)] py-12'>
          <div className='absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-[#4f8cff]/30 to-transparent' />
          <div className='w-full max-w-[390px]'>
            <Outlet />
          </div>
        </section>
      </div>
    </main>
  )
}
