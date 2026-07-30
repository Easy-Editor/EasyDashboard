import { Wifi, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type NetworkState = 'online' | 'offline' | 'reconnected'

export function NetworkStatusNotice() {
  const [state, setState] = useState<NetworkState>(() => (navigator.onLine ? 'online' : 'offline'))
  const wasOffline = useRef(!navigator.onLine)

  useEffect(() => {
    let resetTimer: number | undefined

    const handleOffline = () => {
      wasOffline.current = true
      window.clearTimeout(resetTimer)
      setState('offline')
    }
    const handleOnline = () => {
      if (!wasOffline.current) return
      wasOffline.current = false
      setState('reconnected')
      resetTimer = window.setTimeout(() => setState('online'), 4_000)
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.clearTimeout(resetTimer)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  if (state === 'online') return null

  const offline = state === 'offline'
  const Icon = offline ? WifiOff : Wifi
  return (
    <output
      data-ed-shell='network'
      aria-live='polite'
      className={`fixed right-4 bottom-4 z-[120] flex max-w-[360px] items-start gap-3 border px-4 py-3 shadow-2xl ${
        offline
          ? 'border-[color-mix(in_srgb,var(--ed-warning)_45%,var(--ed-line))] bg-[color-mix(in_srgb,var(--ed-warning)_10%,var(--ed-panel))]'
          : 'border-[color-mix(in_srgb,var(--ed-success)_40%,var(--ed-line))] bg-[color-mix(in_srgb,var(--ed-success)_9%,var(--ed-panel))]'
      }`}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${offline ? 'text-[var(--ed-warning)]' : 'text-[var(--ed-success)]'}`} />
      <div>
        <p className='text-[12px] font-medium text-[var(--ed-ink)]'>
          {offline ? '当前处于离线状态' : '网络已重新连接'}
        </p>
        <p className='mt-1 text-[11px] leading-5 text-[var(--ed-ink-muted)]'>
          {offline ? '浏览和本地编辑仍可继续；保存、发布与同步需等待网络恢复。' : '现在可以继续保存、发布与同步。'}
        </p>
      </div>
    </output>
  )
}
