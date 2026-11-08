import { describe, expect, it } from 'vitest'
import {
  MAX_PROFILES, addProfile, deleteProfile, duplicateProfile, exportProfile, parseProfileImport, renameProfile,
  replaceActive, snapshotOf, switchProfile, syncActive, type Profile, type ProfileData, type ProfileHost,
} from './profiles'
import { PRESETS, PRESET_BY_ID, buildPresetData } from './profilePresets'
import { discardTrace, makeTrace, normalizeProfileData } from './ConfigContext'
import { CHANNEL_MAP } from '../telemetry/simulation'

const LAYOUT = { fuel: true, steering: true, suspension: true, timing: true, gps: true, syncCrosshair: true }
const ORDER = ['gauges', 'steering', 'suspension', 'bottom']
const data = (title: string): ProfileData => ({
  gauges: [{ id: 'g1', channel: 'rpm', style: 'dial', min: 0, max: 8000, warnAt: null, dangerAt: null }],
  layout: { ...LAYOUT }, widgetOrder: [...ORDER],
  chartOrder: [`c-${title}`], chartCfg: { [`c-${title}`]: { title, traces: [makeTrace('rpm')] } },
  panelSizes: {},
})
const host = (): ProfileHost => ({ ...data('A'), profiles: [{ id: 'a', name: 'A', data: data('A') }], activeProfileId: 'a' })
const names = (s: ProfileHost) => s.profiles.map(p => p.name)

describe('profile switching', () => {
  it('edits to the working copy are saved into the profile you switch away from', () => {
    let s = addProfile(host(), { name: 'B', data: data('B') })
    expect(s.activeProfileId).not.toBe('a')
    expect(s.chartOrder).toEqual(['c-B'])
    // edit B, go back to A, then back to B
    s = { ...s, chartCfg: { ...s.chartCfg, 'c-B': { ...s.chartCfg['c-B'], title: 'B edited' } }, layout: { ...s.layout, gps: false } }
    s = switchProfile(s, 'a')
    expect(s.chartOrder).toEqual(['c-A'])
    expect(s.layout.gps).toBe(true)
    s = switchProfile(s, s.profiles[1].id)
    expect(s.chartCfg['c-B'].title).toBe('B edited')
    expect(s.layout.gps).toBe(false)
  })

  it('switching to the active or an unknown profile changes nothing', () => {
    const s = host()
    expect(switchProfile(s, 'a')).toBe(s)
    expect(switchProfile(s, 'nope')).toBe(s)
  })

  it('profiles do not share objects (editing one never leaks into another)', () => {
    let s = addProfile(host(), { name: 'B', data: data('A') })
    s.chartCfg[s.chartOrder[0]].title = 'mutated'
    s = switchProfile(s, 'a')
    expect(s.chartCfg['c-A'].title).toBe('A')
  })

  it('does not touch anything outside the layout', () => {
    const extra = { ...host(), timeRange: { mode: 'lap' }, math: [1], alerts: [2], unitPrefs: { rpm: 'Hz' } }
    const s = switchProfile(addProfile(extra, { name: 'B', data: data('B') }), 'a') as typeof extra
    expect(s.timeRange).toEqual({ mode: 'lap' })
    expect(s.math).toEqual([1])
    expect(s.alerts).toEqual([2])
    expect(s.unitPrefs).toEqual({ rpm: 'Hz' })
  })
})

describe('profile management', () => {
  it('names stay unique and bounded; duplicate copies unsaved edits', () => {
    let s = addProfile(host(), { name: 'A', data: data('B') })
    s = addProfile(s, { name: '  A   ', data: data('B') })
    expect(names(s)).toEqual(['A', 'A 2', 'A 3'])
    expect(addProfile(host(), { name: 'x'.repeat(100), data: data('B') }).profiles[1].name).toHaveLength(40)

    let d = host()
    d = { ...d, chartCfg: { 'c-A': { title: 'unsaved edit', traces: [] } } }
    d = duplicateProfile(d)
    expect(names(d)).toEqual(['A', 'A copy'])
    expect(d.chartCfg['c-A'].title).toBe('unsaved edit')
    d = switchProfile(d, 'a')
    expect(d.chartCfg['c-A'].title).toBe('unsaved edit') // the original kept its edit too
  })

  it('rename ignores blank names and avoids clashes', () => {
    const s = addProfile(host(), { name: 'B', data: data('B') })
    expect(renameProfile(s, 'a', '   ')).toBe(s)
    expect(names(renameProfile(s, 'a', 'B'))).toEqual(['B 2', 'B'])
    expect(names(renameProfile(s, 'a', 'A'))).toEqual(['A', 'B'])
  })

  it('delete: never the last profile; deleting the active one loads its neighbour', () => {
    const one = host()
    expect(deleteProfile(one, 'a')).toBe(one)
    let s = addProfile(addProfile(host(), { name: 'B', data: data('B') }), { name: 'C', data: data('C') })
    const [a, b, c] = s.profiles.map(p => p.id)
    expect(s.activeProfileId).toBe(c)
    s = deleteProfile(s, c)
    expect(s.activeProfileId).toBe(b)
    expect(s.chartOrder).toEqual(['c-B'])
    s = deleteProfile(s, a) // not active: active stays
    expect(s.activeProfileId).toBe(b)
    expect(names(s)).toEqual(['B'])
    expect(deleteProfile(s, 'ghost')).toBe(s)
  })

  it('is capped', () => {
    let s = host()
    for (let i = 0; i < MAX_PROFILES + 5; i++) s = addProfile(s, { name: `P${i}`, data: data('x') })
    expect(s.profiles).toHaveLength(MAX_PROFILES)
  })

  it('syncActive stores the working copy; replaceActive swaps the layout', () => {
    let s = { ...host(), layout: { ...LAYOUT, timing: false } }
    expect(syncActive(s).profiles[0].data.layout.timing).toBe(false)
    s = replaceActive(s, data('Z'))
    expect(s.chartOrder).toEqual(['c-Z'])
    expect(s.layout.timing).toBe(true)
    expect(snapshotOf(s).chartOrder).toEqual(['c-Z'])
  })
})

describe('export / import', () => {
  it('round-trips the active profile including unsaved edits', () => {
    const s = { ...host(), layout: { ...LAYOUT, gps: false } }
    const text = exportProfile(s, 'a')!
    const result = parseProfileImport(text, normalizeProfileData)
    expect(result).toMatchObject({ ok: true, name: 'A' })
    if (result.ok) expect(result.data.layout.gps).toBe(false)
    expect(exportProfile(s, 'missing')).toBeNull()
  })

  it('rejects files that are not profiles and repairs damaged layout data', () => {
    expect(parseProfileImport('not json', normalizeProfileData)).toMatchObject({ ok: false })
    expect(parseProfileImport('[]', normalizeProfileData)).toMatchObject({ ok: false })
    expect(parseProfileImport('{"format":"other"}', normalizeProfileData)).toMatchObject({ ok: false })
    expect(parseProfileImport('{"format":"sdm-dash-profile","version":2,"data":{}}', normalizeProfileData)).toMatchObject({ ok: false, reason: expect.stringContaining('version') })
    expect(parseProfileImport('{"format":"sdm-dash-profile","version":1}', normalizeProfileData)).toMatchObject({ ok: false })
    const messy = parseProfileImport(JSON.stringify({
      format: 'sdm-dash-profile', version: 1, name: '  ',
      data: { gauges: 'x', layout: { gps: 'yes', fuel: false }, widgetOrder: ['bottom', 'evil'], chartOrder: ['c1', 'missing'], chartCfg: { c1: { title: 'T', traces: [{ channel: 'rpm' }, { nope: 1 }] } } },
    }), normalizeProfileData)
    expect(messy.ok).toBe(true)
    if (!messy.ok) return
    expect(messy.name).toBe('Imported')
    expect(messy.data.layout).toMatchObject({ gps: true, fuel: false })
    expect(messy.data.widgetOrder).toEqual(['bottom', 'gauges', 'steering', 'suspension'])
    expect(messy.data.chartOrder).toEqual(['c1'])
    expect(messy.data.chartCfg.c1.traces.map(t => t.channel)).toEqual(['rpm'])
    expect(messy.data.gauges.length).toBeGreaterThan(0)
  })
})

describe('presets', () => {
  it('only reference channels the dashboard knows, and always have a gauge', () => {
    for (const spec of PRESETS) {
      expect(spec.gauges.length).toBeGreaterThan(0)
      for (const chart of spec.charts) {
        expect(chart.channels.length).toBeGreaterThan(0)
        for (const ch of chart.channels) expect(CHANNEL_MAP[ch], `${spec.id}: ${ch}`).toBeDefined()
        for (const ch of Object.keys(chart.ranges ?? {})) expect(chart.channels).toContain(ch)
      }
      for (const g of spec.gauges) expect(CHANNEL_MAP[g.channel], `${spec.id} gauge: ${g.channel}`).toBeDefined()
    }
    expect(new Set(PRESETS.map(p => p.id)).size).toBe(PRESETS.length)
  })

  it('build valid layouts that survive normalization unchanged, with distinct trace colors and unique chart ids', () => {
    for (const spec of PRESETS) {
      const built = buildPresetData(spec, makeTrace, LAYOUT, ORDER)
      expect(normalizeProfileData(built)).toEqual(built)
      for (const id of built.chartOrder) {
        const colors = built.chartCfg[id].traces.map(t => t.color.toLowerCase())
        expect(new Set(colors).size, `${spec.id} ${id}`).toBe(colors.length)
      }
    }
    const a = buildPresetData(PRESET_BY_ID['engine-vitals'], makeTrace, LAYOUT, ORDER)
    const b = buildPresetData(PRESET_BY_ID['engine-vitals'], makeTrace, LAYOUT, ORDER)
    expect(a.chartOrder.filter(id => b.chartOrder.includes(id))).toEqual([])
  })

  it('apply chart ranges and gauge limits', () => {
    const built = buildPresetData(PRESET_BY_ID['engine-vitals'], makeTrace, LAYOUT, ORDER)
    const pressures = built.chartCfg[built.chartOrder[2]]
    expect(pressures.traces.find(t => t.channel === 'raw:p_oil')).toMatchObject({ min: 0, max: 800 })
    expect(built.gauges[0]).toMatchObject({ channel: 'rpm', warnAt: 6800, dangerAt: 7400 })
    expect(built.layout).toMatchObject({ steering: false, suspension: false, timing: true })
    expect(buildPresetData(PRESET_BY_ID.blank, makeTrace, LAYOUT, ORDER).chartOrder).toEqual([])
  })

  it('adding a preset gives a named profile that remembers its preset', () => {
    const spec = PRESET_BY_ID.speeds
    const s = addProfile(host(), { name: spec.name, data: buildPresetData(spec, makeTrace, LAYOUT, ORDER), presetId: spec.id })
    const p = s.profiles.find(x => x.id === s.activeProfileId) as Profile
    expect(p).toMatchObject({ name: 'Speeds', presetId: 'speeds' })
    expect(s.chartOrder).toHaveLength(spec.charts.length)
  })
})

describe('discardTrace (drag a trace back to the channel list)', () => {
  const state = () => {
    const base = host()
    const two = { title: 'T', traces: [makeTrace('rpm'), makeTrace('throttle')] }
    return { ...base, chartOrder: ['c1', 'c2'], chartCfg: { c1: two, c2: { title: 'S', traces: [makeTrace('speed')] } } } as unknown as Parameters<typeof discardTrace>[0]
  }

  it('removes just that trace and keeps the chart while it has others', () => {
    const s = discardTrace(state(), 'c1', 0)
    expect(s.chartCfg.c1.traces.map(t => t.channel)).toEqual(['throttle'])
    expect(s.chartOrder).toEqual(['c1', 'c2'])
  })

  it('removes the chart when its last trace goes, like moving the last trace out', () => {
    const s = discardTrace(state(), 'c2', 0)
    expect(s.chartCfg.c2).toBeUndefined()
    expect(s.chartOrder).toEqual(['c1'])
  })

  it('ignores stale or invalid drags', () => {
    const s = state()
    expect(discardTrace(s, 'gone', 0)).toBe(s)
    expect(discardTrace(s, 'c1', 5)).toBe(s)
    expect(discardTrace(s, 'c1', -1)).toBe(s)
    expect(discardTrace(s, 'c1', 1.5)).toBe(s)
  })
})

describe('panel sizes are part of the profile layout', () => {
  it('each profile keeps its own sizes', () => {
    let s = addProfile(host(), { name: 'B', data: data('B') })
    s = { ...s, panelSizes: { channelList: 240, 'c.c-B': 3 } }
    s = switchProfile(s, 'a')
    expect(s.panelSizes).toEqual({})
    s = { ...s, panelSizes: { timing: 300 } }
    s = switchProfile(s, s.profiles[1].id)
    expect(s.panelSizes).toEqual({ channelList: 240, 'c.c-B': 3 })
    s = switchProfile(s, 'a')
    expect(s.panelSizes).toEqual({ timing: 300 })
  })

  it('duplicates, exports, imports, and repairs them', () => {
    const s = duplicateProfile({ ...host(), panelSizes: { pedal: 150 } })
    expect(s.panelSizes).toEqual({ pedal: 150 })
    const text = exportProfile({ ...host(), panelSizes: { pedal: 150 } }, 'a')!
    const imported = parseProfileImport(text, normalizeProfileData)
    expect(imported.ok && imported.data.panelSizes).toEqual({ pedal: 150 })
    const damaged = parseProfileImport(JSON.stringify({ format: 'sdm-dash-profile', version: 1, data: { panelSizes: { good: 2, bad: 'x', neg: -4 } } }), normalizeProfileData)
    expect(damaged.ok && damaged.data.panelSizes).toEqual({ good: 2 })
  })

  it('presets start with default sizes', () => {
    expect(buildPresetData(PRESET_BY_ID.speeds, makeTrace, LAYOUT, ORDER).panelSizes).toEqual({})
  })
})
