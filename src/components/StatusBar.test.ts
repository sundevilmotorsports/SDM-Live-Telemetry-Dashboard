import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from './widgets'
import { makeFrame } from '../telemetry/simulation'

const NOW = 1_800_000_000_000
const render = (sampleMs: number | null, source: 'supabase' | 'simulation' | 'websocket' = 'supabase') =>
  renderToStaticMarkup(createElement(StatusBar, { cur: makeFrame(10), source, displayedSampleMs: sampleMs }))

afterEach(() => vi.restoreAllMocks())

describe('StatusBar delay', () => {
  it('shows estimated displayed data age immediately after fuel', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const html = render(NOW - 3200)
    expect(html).toContain('~3.2 s')
    expect(html.indexOf('DELAY')).toBeGreaterThan(html.indexOf('FUEL'))
    expect(html).toContain('not measured network latency')
  })

  it('increases age when the displayed frame stops advancing', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW)
    expect(render(NOW - 3200)).toContain('~3.2 s')
    clock.mockReturnValue(NOW + 5000)
    expect(render(NOW - 3200)).toContain('~8.2 s')
  })

  it('flags future timestamps instead of reporting zero latency', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    expect(render(NOW + 1000)).toContain('CLOCK SKEW')
  })

  it('does not invent a delay without usable vehicle timestamps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    for (const html of [render(null), render(NaN), render(NOW, 'simulation'), render(NOW, 'websocket')]) {
      expect(html).toMatch(/DELAY<\/span><span[^>]*>—<\/span>/)
    }
  })
})
