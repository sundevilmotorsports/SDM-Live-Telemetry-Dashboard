import { describe, expect, it } from 'vitest'
import { parseLiveBroadcast, unwrapBroadcast } from './parseLiveBroadcast'

const T_US = 1_790_000_000_900_000
const SEND_MS = 1_790_000_001_000

function payload(values: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    seq: 0,
    send_timestamp_ms: SEND_MS,
    t_us: T_US,
    values,
    ...extra,
  }
}

function wrapped(inner: unknown) {
  return { type: 'broadcast', event: 'live', payload: inner }
}

describe('parseLiveBroadcast', () => {
  it('unwraps the supabase-js broadcast envelope', () => {
    const inner = payload({ 'engine.rpm': 4200.5 })
    expect(unwrapBroadcast(wrapped(inner))).toEqual(inner)
    const parsed = parseLiveBroadcast(wrapped(inner))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.message.values['engine.rpm']).toBe(4200.5)
    expect(parsed.message.tUs).toBe(T_US)
    expect(parsed.message.seq).toBe(0)
  })

  it('accepts a raw contract object and preserves microsecond precision', () => {
    const parsed = parseLiveBroadcast(payload({ 'gps.lat_d': 0.0020000001 }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.message.tUs).toBe(T_US)
    expect(Number.isSafeInteger(parsed.message.tUs)).toBe(true)
  })

  it('rejects non-integer and unsafe timestamps without bitwise truncation', () => {
    expect(parseLiveBroadcast(payload({}, { t_us: T_US + 0.5 })).ok).toBe(false)
    expect(parseLiveBroadcast(payload({}, { send_timestamp_ms: '1790000001000' })).ok).toBe(false)
    expect(parseLiveBroadcast(payload({}, { seq: 1.5 })).ok).toBe(false)
    expect(parseLiveBroadcast(payload({}, { t_us: Number.MAX_SAFE_INTEGER + 2 })).ok).toBe(false)
    expect(parseLiveBroadcast(payload({}, { seq: -1 })).ok).toBe(false)
  })

  it('drops non-finite, null, and non-numeric channel values without inventing zeros', () => {
    const parsed = parseLiveBroadcast(payload({
      'engine.rpm': 4100,
      'engine.tps': null,
      'engine.gear': Number.NaN,
      'imu.lat_g': Number.POSITIVE_INFINITY,
      'imu.long_g': '1.2',
      'brake.front_pressure': 80,
    }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.message.values).toEqual({ 'engine.rpm': 4100, 'brake.front_pressure': 80 })
    expect(parsed.message.rejectedValueCount).toBe(4)
    expect('engine.tps' in parsed.message.values).toBe(false)
  })

  it('rejects a missing or non-object values map', () => {
    expect(parseLiveBroadcast({ seq: 0, send_timestamp_ms: SEND_MS, t_us: T_US }).ok).toBe(false)
    expect(parseLiveBroadcast(payload([] as unknown as Record<string, unknown>)).ok).toBe(false)
    expect(parseLiveBroadcast(null).ok).toBe(false)
    expect(parseLiveBroadcast('live').ok).toBe(false)
    expect(parseLiveBroadcast({ type: 'broadcast', event: 'live' }).ok).toBe(false)
  })
})
