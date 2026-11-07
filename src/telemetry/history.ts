import type { Frame } from './simulation'
import { HZ } from './simulation'

/** Two hours at the dashboard rate. Older frames are dropped (FIFO) beyond this. */
export const MAX_HISTORY_FRAMES = 2 * 60 * 60 * HZ

/**
 * Whole-session frame history for the time series (separate from the short
 * live buffer the gauges and widgets use). Frames are kept in increasing `t`.
 * A frame that jumps more than one second backwards means a new stream
 * (restarted replay, new simulation), so history restarts from it.
 */
export class FrameHistory {
  readonly frames: Frame[] = []
  private readonly cap: number
  private dropped = 0

  constructor(cap: number = MAX_HISTORY_FRAMES) {
    this.cap = Math.max(1, cap)
  }

  /** True when the oldest frames of this stream have been discarded to stay under the cap. */
  get truncated(): boolean {
    return this.dropped > 0
  }

  reset(): void {
    this.frames.length = 0
    this.dropped = 0
  }

  push(frame: Frame): void {
    if (!Number.isFinite(frame.t)) return
    const last = this.frames[this.frames.length - 1]
    if (last) {
      if (frame.t < last.t - 1) this.reset()
      else if (frame.t <= last.t) return
    }
    this.frames.push(frame)
    if (this.frames.length > this.cap) {
      // Trim in chunks so the array is not shifted on every frame.
      const excess = Math.max(this.frames.length - this.cap, Math.floor(this.cap / 100))
      this.frames.splice(0, excess)
      this.dropped += excess
    }
  }
}

/** Index of the first frame with t >= time (frames.length if none). Frames must be sorted by t. */
export function lowerBound(frames: Frame[], time: number): number {
  let lo = 0
  let hi = frames.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (frames[mid].t < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Frames with start <= t < end (end exclusive; pass Infinity for open-ended). */
export function sliceByTime(frames: Frame[], start: number, end: number): Frame[] {
  return frames.slice(lowerBound(frames, start), end === Infinity ? frames.length : lowerBound(frames, end))
}
