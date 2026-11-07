import { describe, expect, it } from 'vitest'
import { emptyFrame } from '../live/mapToFrame'
import { PlayoutBuffer } from './playout'

const frameAt = (t: number) => ({ ...emptyFrame(), t, rpm: Math.round(t * 10) })
/** One car batch: 10 frames on the 10 Hz grid covering (second, second + 1]. */
const batch = (second: number) => Array.from({ length: 10 }, (_, i) => frameAt(Math.round((second * 10 + i + 1)) / 10))

/**
 * Drives the buffer with an animation-frame clock (16 ms) for `seconds`, delivering
 * batches according to `arrivals(second)` (list of batch indices that arrive at the
 * start of that wall second). Returns release wall times keyed by frame t.
 */
function run(seconds: number, arrivals: (second: number) => number[]) {
  const buffer = new PlayoutBuffer(2_000)
  const released: { t: number; wallMs: number }[] = []
  let nextBatchSecond = 0
  for (let wallMs = 0; wallMs < seconds * 1000; wallMs += 16) {
    const second = Math.floor(wallMs / 1000)
    if (second >= nextBatchSecond) {
      for (const b of arrivals(second)) buffer.push(batch(b))
      nextBatchSecond = second + 1
    }
    for (const f of buffer.release(wallMs)) released.push({ t: f.t, wallMs })
  }
  return released
}

function steadyIntervals(released: { t: number; wallMs: number }[], fromWallMs: number) {
  const steady = released.filter(r => r.wallMs >= fromWallMs)
  return steady.slice(1).map((r, i) => r.wallMs - steady[i].wallMs)
}

describe('PlayoutBuffer', () => {
  it('turns one-second bursts into a steady ~10 Hz release', () => {
    // Batch n (data second n..n+1) arrives at wall second n + 1, like the car + poll.
    const released = run(30, s => (s >= 1 ? [s - 1] : []))
    const intervals = steadyIntervals(released, 5_000)
    expect(intervals.length).toBeGreaterThan(200)
    for (const dt of intervals) {
      expect(dt).toBeGreaterThanOrEqual(80)
      expect(dt).toBeLessThanOrEqual(120)
    }
    // Strictly in time order, never repeats or invents samples.
    for (let i = 1; i < released.length; i++) expect(released[i].t).toBeGreaterThan(released[i - 1].t)
  })

  it('stays smooth when the poll picks up 0 batches one second and 2 the next', () => {
    // Every 4th second nothing arrives, the following second brings two batches.
    let next = 0
    const released = run(40, s => {
      if (s < 1 || s % 4 === 0) return []
      const due = s - 1
      const out: number[] = []
      while (next <= due) out.push(next++)
      return out
    })
    const intervals = steadyIntervals(released, 8_000)
    expect(intervals.length).toBeGreaterThan(250)
    for (const dt of intervals) {
      expect(dt).toBeGreaterThanOrEqual(80)
      expect(dt).toBeLessThanOrEqual(120)
    }
  })

  it('shows existing history at once, then plays the newest ~2 s smoothly', () => {
    const buffer = new PlayoutBuffer(2_000)
    for (let s = 0; s < 20; s++) buffer.push(batch(s))
    const first = buffer.release(0)
    expect(first.length).toBe(180)
    expect(first[first.length - 1].t).toBeCloseTo(18, 6)
    expect(buffer.release(16)).toEqual([])
    expect(buffer.release(110).map(f => f.t)).toEqual([18.1])
  })

  it('holds at the newest frame when data stops instead of inventing samples', () => {
    const buffer = new PlayoutBuffer(2_000)
    buffer.push(batch(0))
    let count = 0
    for (let wallMs = 0; wallMs <= 10_000; wallMs += 16) count += buffer.release(wallMs).length
    expect(count).toBe(10)
    expect(buffer.release(20_000)).toEqual([])
    expect(buffer.lagSeconds).toBe(0)
  })

  it('jumps forward instead of crawling when it falls far behind', () => {
    const buffer = new PlayoutBuffer(2_000)
    buffer.push(batch(0))
    buffer.release(0)
    // A long backlog lands at once (e.g. tab was hidden): 10 s of new data.
    for (let s = 1; s <= 10; s++) buffer.push(batch(s))
    const burst = buffer.release(16)
    expect(burst[burst.length - 1].t).toBeCloseTo(9, 6)
    expect(buffer.lagSeconds).toBeCloseTo(2, 1)
  })

  it('reset clears queued frames and playback position', () => {
    const buffer = new PlayoutBuffer(2_000)
    for (let s = 0; s < 5; s++) buffer.push(batch(s))
    buffer.release(0)
    buffer.reset()
    expect(buffer.release(1_000)).toEqual([])
    buffer.push([frameAt(0.1)])
    expect(buffer.release(2_000)).toEqual([])
  })
})
