import { describe, expect, it } from 'vitest'
import { ChannelActivityTracker } from './channelActivity'
import type { ChannelState } from './live/types'
import { RawBatchSession } from './raw/RawBatchSession'

const state = (entries: Record<string, [tUs: number, receivedAtMs: number, value?: number]>): ChannelState =>
  Object.fromEntries(Object.entries(entries).map(([id, [tUs, receivedAtMs, value]]) => [id, { value: value ?? 1, tUs, receivedAtMs }]))

describe('ChannelActivityTracker', () => {
  it('measures the rate from device timestamps, independent of arrival bursts', () => {
    const tracker = new ChannelActivityTracker()
    // 100 Hz channel (10 ms apart) and a 10 Hz channel, all delivered at the same wall-clock instant.
    for (let i = 0; i < 100; i++) {
      tracker.observe(state({ fast: [1_000_000 + i * 10_000, 5000], ...(i % 10 === 0 ? { slow: [1_000_000 + i * 10_000, 5000] as [number, number] } : {}) }))
    }
    expect(tracker.rateHz('fast')).toBeCloseTo(100, 6)
    expect(tracker.rateHz('slow')).toBeCloseTo(10, 6)
  })

  it('has no rate until a second distinct sample, and re-observing a state counts nothing', () => {
    const tracker = new ChannelActivityTracker()
    const s = state({ a: [1_000_000, 0] })
    tracker.observe(s)
    tracker.observe(s)
    expect(tracker.rateHz('a')).toBeNull()
    tracker.observe(state({ a: [1_500_000, 0] }))
    expect(tracker.rateHz('a')).toBeCloseTo(2, 9)
    tracker.observe(state({ a: [1_500_000, 0] }))
    tracker.observe(state({ a: [1_400_000, 0] })) // older than the newest: ignored
    expect(tracker.rateHz('a')).toBeCloseTo(2, 9)
  })

  it('reports a channel as receiving only while samples keep arriving', () => {
    const tracker = new ChannelActivityTracker()
    const s = state({ live: [10_000_000, 100_000], quiet: [10_000_000, 90_000], nan: [10_000_000, 100_000, NaN] })
    tracker.observe(s)
    const byId = Object.fromEntries(tracker.stats(s, 102_000, 3500).map(x => [x.id, x]))
    expect(byId.live.active).toBe(true)
    expect(byId.quiet.active).toBe(false) // 12 s since the last sample
    expect(byId.nan.active).toBe(false) // not a number is never "receiving data"
    // The held value is still reported, the channel just is not active.
    expect(byId.quiet.value).toBe(1)
  })

  it('allows a slow channel three of its own periods before calling it silent', () => {
    const tracker = new ChannelActivityTracker()
    // One sample every 5 s of device time (0.2 Hz): longer than the 3.5 s stale window.
    tracker.observe(state({ slow: [0, 0] }))
    const s = state({ slow: [5_000_000, 100_000] })
    tracker.observe(s)
    expect(tracker.stats(s, 108_000, 3500)[0].active).toBe(true) // 8 s < 3 × 5 s
    expect(tracker.stats(s, 120_000, 3500)[0].active).toBe(false)
  })

  it('reset forgets rates', () => {
    const tracker = new ChannelActivityTracker()
    tracker.observe(state({ a: [0, 0] }))
    tracker.observe(state({ a: [100_000, 0] }))
    tracker.reset()
    expect(tracker.rateHz('a')).toBeNull()
  })
})

describe('RawBatchSession → tracker', () => {
  it('measures the CAN rate before resampling (100 Hz stays 100 Hz, not the 10 Hz chart rate)', async () => {
    const SESSION = '11111111-1111-4111-8111-111111111111'
    const T0 = 1735500000000
    // ECU 0x3E8 mux 0 carries r_engine; a frame every 10 ms for 3 s.
    const frames = Array.from({ length: 300 }, (_, i) => ({
      can_id: 1000, extd: false, dlc: 8, ts_ms: T0 + i * 10,
      data: '00' + (1000 + i).toString(16).padStart(4, '0') + '0000000000',
    }))
    const page = [{ id: '1', session_id: SESSION, device_id: 'car-1', seq: 0, dropped_frames: 0, frames, sent_at: new Date(T0 + 3000).toISOString() }]
    const tracker = new ChannelActivityTracker()
    const session = new RawBatchSession({
      client: { fetchPage: async ({ afterId }) => (afterId === null ? page : []) },
      sessionId: SESSION, staleAfterMs: 3500, now: () => T0 + 3000,
      onSample: s => tracker.observe(s.channels),
    })
    session.start()
    await new Promise(resolve => setTimeout(resolve, 20))
    const channels = session.snapshot().channels
    session.stop()
    expect(tracker.rateHz('r_engine')).toBeCloseTo(100, 3)
    expect(tracker.stats(channels, T0 + 3500, 3500).find(s => s.id === 'r_engine')?.active).toBe(true)
    expect(tracker.stats(channels, T0 + 60_000, 3500).find(s => s.id === 'r_engine')?.active).toBe(false)
  })
})
