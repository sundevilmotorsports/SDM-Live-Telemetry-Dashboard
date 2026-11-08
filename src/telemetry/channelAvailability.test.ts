import { describe, expect, it } from 'vitest'
import { buildChannelRows, makeAvailability, type AvailabilityInput } from './channelAvailability'
import type { ChannelStat } from './channelActivity'
import { makeFrame } from './simulation'
import type { MathChannel } from '../state/ConfigContext'

const stat = (id: string, value: number, active = true, rateHz: number | null = 100): ChannelStat => ({ id, value, tUs: 0, receivedAtMs: 0, rateHz, active })
const base = (over: Partial<AvailabilityInput>): AvailabilityInput => ({ source: 'supabase', mode: 'raw', stats: [], latest: undefined, connected: false, ...over })
const math: MathChannel[] = [
  { id: 'm1', name: 'Avg Wheel', unit: 'km/h', expr: '(wFL + wFR + wRL + wRR) / 4' },
  { id: 'm2', name: 'Throttle x2', unit: '%', expr: 'throttle * 2' },
  { id: 'm3', name: 'Constant', unit: '', expr: '5' },
]

describe('makeAvailability', () => {
  it('simulation: every channel is receiving', () => {
    const isLive = makeAvailability(base({ source: 'simulation' }))
    expect(isLive('speed', math)).toBe(true)
    expect(isLive('math:m1', math)).toBe(true)
  })

  it('raw: only channels whose source had a recent sample are white', () => {
    const isLive = makeAvailability(base({ stats: [stat('r_engine', 3000), stat('%_TPS', 7, false), stat('t_oil', 98)] }))
    expect(isLive('rpm', math)).toBe(true)
    expect(isLive('throttle', math)).toBe(false) // arrived once, now silent
    expect(isLive('oilTemp', math)).toBe(true)
    expect(isLive('speed', math)).toBe(false) // no raw mapping
    expect(isLive('nonsense', math)).toBe(false)
  })

  it('raw: a stale source is not receiving even though its value is still held', () => {
    const isLive = makeAvailability(base({ stats: [stat('r_engine', 3000, false)] }))
    expect(isLive('rpm', math)).toBe(false)
  })

  it('math channels need every input receiving; constants never are', () => {
    const isLive = makeAvailability(base({ stats: [stat('%_TPS', 7), stat('r_engine', 3000)] }))
    expect(isLive('math:m2', math)).toBe(true)
    expect(isLive('math:m1', math)).toBe(false)
    expect(isLive('math:m3', math)).toBe(false)
    expect(isLive('math:missing', math)).toBe(false)
  })

  it('wheel reference needs two live wheel speeds (broadcast has none mapped)', () => {
    expect(makeAvailability(base({ mode: 'broadcast', stats: [stat('engine.rpm', 3000)] }))('wheelRef', math)).toBe(false)
  })

  it('broadcast uses the broadcast channel ids', () => {
    const isLive = makeAvailability(base({ mode: 'broadcast', stats: [stat('engine.rpm', 3000), stat('r_engine', 1)] }))
    expect(isLive('rpm', math)).toBe(true)
    expect(isLive('throttle', math)).toBe(false)
  })

  it('websocket: needs an open socket and a real number', () => {
    const latest = { ...makeFrame(1), rpm: NaN }
    expect(makeAvailability(base({ source: 'websocket', latest, connected: true }))('speed', math)).toBe(true)
    expect(makeAvailability(base({ source: 'websocket', latest, connected: true }))('rpm', math)).toBe(false)
    expect(makeAvailability(base({ source: 'websocket', latest, connected: false }))('speed', math)).toBe(false)
    expect(makeAvailability(base({ source: 'websocket', latest: undefined, connected: true }))('speed', math)).toBe(false)
  })
})

describe('logger channels (raw:<name>)', () => {
  it('are receiving only in raw mode with a fresh source sample', () => {
    const stats = [stat('t_MAT', 40), stat('a_Lat', 0.1, false)]
    expect(makeAvailability(base({ stats }))('raw:t_MAT', math)).toBe(true)
    expect(makeAvailability(base({ stats }))('raw:a_Lat', math)).toBe(false)
    expect(makeAvailability(base({ source: 'simulation' }))('raw:t_MAT', math)).toBe(false) // simulation has no logger data
    expect(makeAvailability(base({ mode: 'broadcast', stats }))('raw:t_MAT', math)).toBe(false)
  })

  it('math can use logger names, quoted when they are not identifiers', () => {
    const m: MathChannel[] = [{ id: 'x', name: 'x', unit: '', expr: "t_MAT + '%_TPS' + r_engine" }]
    expect(makeAvailability(base({ stats: [stat('t_MAT', 1), stat('%_TPS', 1), stat('r_engine', 1)] }))('math:x', m)).toBe(true)
    expect(makeAvailability(base({ stats: [stat('t_MAT', 1), stat('%_TPS', 1)] }))('math:x', m)).toBe(false)
  })

  it('opaque byte arrays get a hex row; numeric channels never get a duplicate hex row', () => {
    const rows = buildChannelRows({ ...base({ stats: [stat('MLPOT', 42)] }), packetRate: 0, opaque: [{ id: 'FLT_TTA', hex: '0102030405060708' }, { id: 'MLPOT', hex: '2a' }] })
    expect(rows.map(r => r.sourceId).sort()).toEqual(['FLT_TTA', 'MLPOT'])
    expect(rows.find(r => r.sourceId === 'FLT_TTA')).toMatchObject({ key: 'raw:FLT_TTA', group: 'Wheels & Tyres', hex: '0102030405060708' })
    expect(rows.find(r => r.sourceId === 'MLPOT')).toMatchObject({ value: 42, group: 'Pots (0x3B0)' })
  })
})

describe('buildChannelRows', () => {
  it('raw: lists only receiving channels, mapped ones under their dashboard name, others by logger id', () => {
    const rows = buildChannelRows({
      ...base({ stats: [stat('r_engine', 2634, true, 100), stat('t_MAT', 40.5, true, 10), stat('a_Lat', 0.2, true, 50), stat('%_TPS', 7, false), stat('rate_lpm_1', 3, true, null)] }),
      packetRate: 0,
    })
    expect(rows.map(r => r.sourceId).sort()).toEqual(['a_Lat', 'r_engine', 'rate_lpm_1', 't_MAT'])
    const rpm = rows.find(r => r.sourceId === 'r_engine')!
    expect(rpm).toMatchObject({ key: 'rpm', label: 'Engine RPM', baseUnit: 'rpm', value: 2634, rateHz: 100 })
    expect(rows.find(r => r.sourceId === 't_MAT')).toMatchObject({ key: 'raw:t_MAT', group: 'Engine (ECU)', baseUnit: '°C', rateHz: 10 })
    expect(rows.find(r => r.sourceId === 'a_Lat')).toMatchObject({ key: 'raw:a_Lat', group: 'IMU', baseUnit: '' }) // unit not known: no guess
    expect(rows.find(r => r.sourceId === 'rate_lpm_1')).toMatchObject({ baseUnit: 'L/min', rateHz: null })
    expect(rows[0]).toMatchObject({ group: 'Dashboard', sourceId: 'r_engine' }) // dashboard channels first, then logger groups
    expect(rows.slice(1).map(r => r.group)).toEqual(['Engine (ECU)', 'Fuel Flow', 'IMU'])
  })

  it('broadcast: applies the mapping conversion so the value matches the dashboard unit', () => {
    const rows = buildChannelRows({
      ...base({ mode: 'broadcast', stats: [stat('engine.oil_pressure', 450, true, 10), stat('imu.vert_g', 1, true, 10)] }),
      packetRate: 0,
    })
    expect(rows.find(r => r.sourceId === 'engine.oil_pressure')).toMatchObject({ key: 'oilPress', baseUnit: 'bar', value: 4.5 })
    expect(rows.find(r => r.sourceId === 'imu.vert_g')).toMatchObject({ key: 'imu.vert_g', label: 'Vertical G', baseUnit: 'g' })
  })

  it('simulation lists every dashboard channel at the simulation rate', () => {
    const rows = buildChannelRows({ ...base({ source: 'simulation', latest: makeFrame(2) }), packetRate: 10 })
    expect(rows.length).toBeGreaterThan(10)
    expect(rows.every(r => r.rateHz === 10 && Number.isFinite(r.value))).toBe(true)
  })

  it('websocket lists only finite channels, at the measured packet rate', () => {
    const latest = { ...makeFrame(2), fuel: NaN }
    const rows = buildChannelRows({ ...base({ source: 'websocket', latest, connected: true }), packetRate: 20 })
    expect(rows.some(r => r.key === 'fuel')).toBe(false)
    expect(rows.find(r => r.key === 'speed')?.rateHz).toBe(20)
    expect(buildChannelRows({ ...base({ source: 'websocket', latest, connected: false }), packetRate: 20 })).toEqual([])
  })
})
