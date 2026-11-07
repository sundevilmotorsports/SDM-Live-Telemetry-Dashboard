import type { Frame } from './simulation'

/** A lap in session time (seconds, same clock as Frame.t). end === null means in progress. */
export interface LapSpan {
  num: number
  start: number
  end: number | null
}

/**
 * Laps from frames that carry lap timing (simulation, WebSocket producers that
 * send lapNum/lapTime). Each lap starts at t - lapTime of its first frame.
 * Raw CAN has no lap fields (NaN), so this returns [] and manual marks are used.
 */
export function lapsFromFrames(frames: Frame[]): LapSpan[] {
  const starts = new Map<number, number>()
  for (const f of frames) {
    if (!Number.isFinite(f.lapNum) || !Number.isFinite(f.lapTime)) continue
    if (!starts.has(f.lapNum)) starts.set(f.lapNum, f.t - f.lapTime)
  }
  const laps = [...starts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([num, start]) => ({ num, start, end: null as number | null }))
  for (let i = 0; i < laps.length - 1; i++) laps[i].end = laps[i + 1].start
  return laps
}

/**
 * Laps from manual start/finish marks (session times). The first mark starts
 * lap 1; each later mark ends the previous lap and starts the next. Data before
 * the first mark is the out-lap and is not a lap.
 */
export function lapsFromMarks(marks: number[]): LapSpan[] {
  const sorted = [...new Set(marks.filter(Number.isFinite))].sort((a, b) => a - b)
  return sorted.map((start, i) => ({ num: i + 1, start, end: i + 1 < sorted.length ? sorted[i + 1] : null }))
}

export function lapLength(lap: LapSpan, newestT: number): number {
  return Math.max(0, (lap.end ?? newestT) - lap.start)
}

export function bestLap(laps: LapSpan[]): LapSpan | null {
  let best: LapSpan | null = null
  for (const lap of laps) {
    if (lap.end === null) continue
    if (!best || lap.end - lap.start < (best.end! - best.start)) best = lap
  }
  return best
}

/** The completed lap immediately before `lap`, if any. */
export function lapBefore(laps: LapSpan[], lap: LapSpan): LapSpan | null {
  const i = laps.findIndex(l => l.num === lap.num)
  return i > 0 && laps[i - 1].end !== null ? laps[i - 1] : null
}
