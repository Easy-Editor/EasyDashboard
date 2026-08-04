import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DateTime, { formatDateTime, getDateTimeRefreshInterval, startDateTimeTicker } from './component'

describe('DateTime material', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats only the requested date and time portions with safe Intl options', () => {
    const value = new Date('2026-08-02T04:05:06.000Z')

    expect(
      formatDateTime(value, {
        dateStyle: 'short',
        hour12: false,
        locale: 'en-US',
        mode: 'datetime',
        timeStyle: 'medium',
        timeZone: 'UTC',
      }),
    ).toBe(
      new Intl.DateTimeFormat('en-US', {
        dateStyle: 'short',
        hour12: false,
        timeStyle: 'medium',
        timeZone: 'UTC',
      }).format(value),
    )
  })

  it('formats a deterministic financial-dashboard clock in the selected time zone', () => {
    const value = new Date('2026-08-02T04:05:06.000Z')

    expect(
      formatDateTime(value, {
        dateFormat: 'dot',
        dateStyle: 'medium',
        hour12: false,
        locale: 'zh-CN',
        mode: 'datetime',
        timeFormat: 'hms',
        timeStyle: 'medium',
        timeZone: 'Asia/Shanghai',
      }),
    ).toBe('2026.08.02 12:05:06')
  })

  it('renders semantic live-time markup and configured typography', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T04:05:06.000Z'))

    const markup = renderToStaticMarkup(
      <DateTime color='#202631' fontSize={30} fontWeight={700} letterSpacing={2} mode='time' textAlign='right' />,
    )

    expect(markup).toContain('role="timer"')
    expect(markup).toContain('aria-live="off"')
    expect(markup).toContain('dateTime="2026-08-02T04:05:06.000Z"')
    expect(markup).toContain('color:#202631')
    expect(markup).toContain('font-size:30px')
    expect(markup).toContain('font-weight:700')
    expect(markup).toContain('letter-spacing:2px')
    expect(markup).toContain('text-align:right')
  })

  it('refreshes at the selected cadence and returns an effective cleanup', () => {
    vi.useFakeTimers()
    const onTick = vi.fn()
    const stop = startDateTimeTicker(onTick, 'second')

    vi.advanceTimersByTime(2_000)
    expect(onTick).toHaveBeenCalledTimes(2)

    stop()
    vi.advanceTimersByTime(2_000)
    expect(onTick).toHaveBeenCalledTimes(2)
    expect(getDateTimeRefreshInterval('minute')).toBe(60_000)
  })
})
