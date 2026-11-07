import { describe, expect, it } from 'vitest'
import { BUFFER } from '../simulation'
import { emptyFrame } from '../live/mapToFrame'
import { FrameResampler, binOf } from './resampleFrames'
import { RawBatchSession } from './RawBatchSession'
import { rawChannelsToFrame } from './mapRawToFrame'

const at = (t: number, rpm: number) => ({ ...emptyFrame(), t, rpm })

function run(samples: [number, number][]) {
  const r = new FrameResampler()
  return samples.flatMap(([t, rpm]) => r.push(at(t, rpm)))
}

describe('binOf', () => {
  it('buckets 100 ms bins without float drift', () => {
    expect(binOf(0)).toBe(0)
    expect(binOf(0.099999)).toBe(0)
    expect(binOf(0.1)).toBe(1)
    expect(binOf(0.3)).toBe(3) // 0.3 * 10 is 2.9999999999999996 in floats
    expect(binOf(18)).toBe(180)
  })
})

describe('FrameResampler', () => {
  it('collapses a CAN-rate burst into one frame per 100 ms bin, keeping the newest state in the bin', () => {
    // 1 kHz samples across 1 s: rpm rises by 1 per ms.
    const samples: [number, number][] = Array.from({ length: 1001 }, (_, i) => [i / 1000, i])
    const out = run(samples)
    expect(out).toHaveLength(10)
    expect(out.map(f => f.t)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
    expect(out[0].rpm).toBe(99) // last sample inside [0, 100) ms
    expect(out[9].rpm).toBe(999)
  })

  it('emits nothing until a later bin arrives, then closes the earlier bin', () => {
    const r = new FrameResampler()
    expect(r.push(at(0, 1))).toEqual([])
    expect(r.push(at(0.05, 2))).toEqual([])
    const out = r.push(at(0.12, 3))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ t: 0.1, rpm: 2 })
  })

  it('holds the last state across bins with no data', () => {
    const out = run([[0, 10], [0.45, 20]])
    expect(out.map(f => [f.t, f.rpm])).toEqual([[0.1, 10], [0.2, 10], [0.3, 10], [0.4, 10]])
  })

  it('makes the buffer span BUFFER / HZ seconds of device time (18 s)', () => {
    const samples: [number, number][] = Array.from({ length: 19_000 }, (_, i) => [i / 1000, i])
    const out = run(samples)
    expect(out.length).toBeGreaterThanOrEqual(BUFFER)
    const window = out.slice(-BUFFER)
    expect(window[window.length - 1].t - window[0].t).toBeCloseTo((BUFFER - 1) / 10, 6)
  })

  it('caps a long gap to the last BUFFER bins', () => {
    const out = run([[0, 1], [3600, 2]])
    expect(out).toHaveLength(BUFFER)
    expect(out[out.length - 1].t).toBe(3600)
    expect(out.every(f => f.rpm === 1)).toBe(true)
  })

  it('never moves time backward and ignores unusable timestamps', () => {
    const r = new FrameResampler()
    r.push(at(1, 1))
    expect(r.push(at(0.2, 2))).toEqual([]) // folded into the open bin
    expect(r.push(at(NaN, 3))).toEqual([])
    expect(r.push(at(-1, 4))).toEqual([])
    const out = r.push(at(1.15, 5))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ t: 1.1, rpm: 2 })
  })

  it('does not mutate the held frame and reset() starts a new stream', () => {
    const r = new FrameResampler()
    const first = at(0, 1)
    r.push(first)
    const [emitted] = r.push(at(0.2, 2))
    emitted.rpm = 999
    expect(first.rpm).toBe(1)
    r.reset()
    expect(r.push(at(5, 7))).toEqual([])
  })
})

describe('RawBatchSession → resampler pipeline', () => {
  it('turns a 100 Hz CAN stream into a 10 Hz timeline spanning real time (ts_ms), not one frame per CAN frame', async () => {
    const SESSION = '11111111-1111-4111-8111-111111111111'
    const T0 = 1735500000000
    // ECU 0x3E8 mux 0: r_engine = big-endian u16 in bytes 1-2. One frame every 10 ms for 3 s.
    const frames = Array.from({ length: 300 }, (_, i) => ({
      can_id: 1000, extd: false, dlc: 8, ts_ms: T0 + i * 10,
      data: '00' + (1000 + i).toString(16).padStart(4, '0') + '0000000000',
    }))
    const page = [{
      id: '1', session_id: SESSION, device_id: 'car-1', seq: 0, dropped_frames: 0,
      frames, received_at: new Date(T0 + 3000).toISOString(),
    }]
    const resampler = new FrameResampler()
    const emitted: ReturnType<typeof at>[] = []
    let accepted = 0
    const session = new RawBatchSession({
      client: { fetchPage: async ({ afterId }) => (afterId === null ? page : []) },
      sessionId: SESSION,
      staleAfterMs: 3500,
      now: () => T0 + 3000,
      onAccepted: next => {
        accepted++
        emitted.push(...resampler.push(rawChannelsToFrame(next.channels, next.sessionStartUs, next.diagnostics.latestSampleUs).frame))
      },
    })
    session.start()
    await new Promise(resolve => setTimeout(resolve, 20))
    session.stop()

    expect(accepted).toBe(300) // one buffer frame per CAN frame without resampling
    expect(emitted).toHaveLength(29) // bins 0..28 closed; the newest 100 ms is still pending
    expect(emitted.map(f => f.t)).toEqual(Array.from({ length: 29 }, (_, i) => (i + 1) / 10))
    // Newest state inside each bin: bin 0 holds frames 0..9 -> rpm 1009.
    expect(emitted[0].rpm).toBe(1009)
    expect(emitted[28].rpm).toBe(1000 + 289)
  })
})
