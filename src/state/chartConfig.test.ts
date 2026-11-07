import { describe, expect, it } from 'vitest'
import { applyDrop, makeTrace, nextTraceColor, normalizeCharts, normalizeGauges, type ConfigState } from './ConfigContext'

describe('normalizeCharts', () => {
  it('migrates pre-grouping one-channel charts into a chart with traces, keeping user edits', () => {
    const { chartOrder, chartCfg } = normalizeCharts(
      ['throttle', 'wheels'],
      {
        throttle: { channel: 'rpm', color: '#123456', min: 0, max: 9000, warnAt: 7000, dangerAt: null },
        wheels: { channel: 'wFL', color: '#00ffff', min: 0, max: 200, warnAt: null, dangerAt: null },
      },
    )
    expect(chartOrder).toEqual(['throttle', 'wheels'])
    expect(chartCfg.throttle).toEqual({
      title: 'THROTTLE',
      traces: [{ channel: 'rpm', color: '#123456', min: 0, max: 9000, warnAt: 7000, dangerAt: null, hidden: false }],
    })
    // The old wheel chart drew FR/RL/RR as fixed extras; they become real traces on the same scale.
    expect(chartCfg.wheels.traces.map(t => [t.channel, t.max])).toEqual([['wFL', 200], ['wFR', 200], ['wRL', 200], ['wRR', 200]])
  })

  it('keeps grouped configs and user-added charts, drops invalid traces and unknown ids', () => {
    const { chartOrder, chartCfg } = normalizeCharts(
      ['chart-abc', 'ghost', 'brake'],
      {
        'chart-abc': { title: 'ENGINE', traces: [{ channel: 'rpm', color: '#ff9933', min: 0, max: 8000, hidden: true }, { color: '#fff' }, null] },
      },
    )
    expect(chartOrder).toEqual(['chart-abc', 'brake'])
    expect(chartCfg['chart-abc'].title).toBe('ENGINE')
    expect(chartCfg['chart-abc'].traces).toHaveLength(1)
    expect(chartCfg['chart-abc'].traces[0]).toMatchObject({ channel: 'rpm', hidden: true, warnAt: null })
    expect(chartCfg.brake.traces[0].channel).toBe('brake')
  })

  it('falls back to defaults for missing or garbage saved state', () => {
    const { chartOrder, chartCfg } = normalizeCharts(undefined, 'nope')
    expect(chartOrder).toEqual(['throttle', 'brake', 'steering', 'wheels'])
    expect(chartCfg.steering.traces[0]).toMatchObject({ channel: 'steering', min: -90, max: 90 })
    expect(chartCfg.wheels.traces.at(-1)).toMatchObject({ channel: 'wheelRef', color: '#ffffff', min: 0, max: 240 })
  })
})

describe('trace helpers', () => {
  it('uses the channel registry scale and picks an unused color', () => {
    expect(makeTrace('rpm')).toMatchObject({ channel: 'rpm', min: 0, max: 8000, hidden: false })
    expect(makeTrace('math:m1')).toMatchObject({ min: 0, max: 100 })
    const used = [makeTrace('rpm', '#00ff41'), makeTrace('speed', '#ff3333')]
    expect(['#00ff41', '#ff3333']).not.toContain(nextTraceColor(used))
  })
})

describe('applyDrop (drag-and-drop grouping)', () => {
  const state = (): ConfigState => ({ ...normalizeCharts(['throttle', 'brake', 'wheels'], undefined), math: [] } as unknown as ConfigState)
  const channels = (s: ConfigState) => s.chartOrder.map(id => s.chartCfg[id].traces.map(t => t.channel))

  it('overlays a channel from the list into a chart with an unused color', () => {
    const s = applyDrop(state(), 'rpm', null, { kind: 'into', chartId: 'throttle' })
    expect(s.chartCfg.throttle.traces.map(t => t.channel)).toEqual(['throttle', 'rpm'])
    expect(s.chartCfg.throttle.traces[1].color).not.toBe(s.chartCfg.throttle.traces[0].color)
  })

  it('does not overlay the same channel twice from the list', () => {
    const before = state()
    expect(applyDrop(before, 'throttle', null, { kind: 'into', chartId: 'throttle' })).toBe(before)
  })

  it('creates a new chart at the drop position, titled after the channel', () => {
    const s = applyDrop(state(), 'rpm', null, { kind: 'new', index: 1 })
    expect(channels(s)).toEqual([['throttle'], ['rpm'], ['brake'], ['wFL', 'wFR', 'wRL', 'wRR', 'wheelRef']])
    expect(s.chartCfg[s.chartOrder[1]].title).toBe('ENGINE RPM')
  })

  it('moves a trace between charts, keeping its settings, and removes the emptied chart', () => {
    const start = state()
    start.chartCfg.brake.traces[0] = { ...start.chartCfg.brake.traces[0], color: '#abcdef', max: 150 }
    const s = applyDrop(start, 'brake', { chartId: 'brake', index: 0, trace: start.chartCfg.brake.traces[0] }, { kind: 'into', chartId: 'throttle' })
    expect(s.chartOrder).toEqual(['throttle', 'wheels'])
    expect(s.chartCfg.throttle.traces[1]).toMatchObject({ channel: 'brake', color: '#abcdef', max: 150 })
    expect(s.chartCfg.brake).toBeUndefined()
  })

  it('splits a trace out of a group into its own chart below it', () => {
    const start = state()
    const wRL = start.chartCfg.wheels.traces[2]
    const s = applyDrop(start, 'wRL', { chartId: 'wheels', index: 2, trace: wRL }, { kind: 'new', index: 3 })
    expect(channels(s)).toEqual([['throttle'], ['brake'], ['wFL', 'wFR', 'wRR', 'wheelRef'], ['wRL']])
  })

  it('keeps the insertion point right when the emptied source chart sat above it', () => {
    const start = state()
    const t = start.chartCfg.throttle.traces[0]
    const s = applyDrop(start, 'throttle', { chartId: 'throttle', index: 0, trace: t }, { kind: 'new', index: 2 })
    expect(channels(s)).toEqual([['brake'], ['throttle'], ['wFL', 'wFR', 'wRL', 'wRR', 'wheelRef']])
  })

  it('ignores dropping a trace back onto its own chart', () => {
    const start = state()
    const t = start.chartCfg.brake.traces[0]
    expect(applyDrop(start, 'brake', { chartId: 'brake', index: 0, trace: t }, { kind: 'into', chartId: 'brake' })).toBe(start)
  })
})

describe('normalizeGauges', () => {
  it('treats gauges saved before styles existed as dials and keeps their settings', () => {
    expect(normalizeGauges([{ id: 'g1', channel: 'rpm', min: 0, max: 9000, warnAt: 7000, dangerAt: 7600 }])).toEqual([
      { id: 'g1', channel: 'rpm', style: 'dial', min: 0, max: 9000, warnAt: 7000, dangerAt: 7600 },
    ])
  })

  it('keeps bar styles, fills missing scales from the channel, and drops junk', () => {
    const out = normalizeGauges([{ id: 'a', channel: 'coolant', style: 'vbar' }, { id: 'b', channel: 'speed', style: 'hbar' }, { style: 'dial' }, 7])
    expect(out.map(g => [g.id, g.style, g.min, g.max])).toEqual([['a', 'vbar', 40, 130], ['b', 'hbar', 0, 240]])
  })

  it('falls back to the default gauges when nothing valid is saved', () => {
    expect(normalizeGauges(undefined).map(g => g.channel)).toEqual(['speed', 'rpm'])
    expect(normalizeGauges([{ nope: true }]).map(g => g.style)).toEqual(['dial', 'dial'])
  })
})
