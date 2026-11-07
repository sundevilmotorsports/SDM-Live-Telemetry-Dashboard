import type { Frame } from '../simulation'

/**
 * Display delay behind the newest received sample. Raw CAN arrives in bursts
 * (one batch per second from the car, picked up by a once-per-second poll, so
 * up to ~2 s can pass between arrivals). Playing back this far behind the
 * newest sample leaves enough queued data to keep a steady rate through a gap.
 */
export const PLAYOUT_DELAY_MS = 2_000

/** Beyond this lag (e.g. after a hidden tab or an outage) jump instead of catching up slowly. */
const SNAP_EXTRA_S = 3
/** Playback speed correction per second of lag error, clamped to +/- MAX_RATE_ADJUST. */
const RATE_GAIN = 0.05
const MAX_RATE_ADJUST = 0.05

/**
 * Jitter buffer for the resampled 10 Hz frames. Frames go in as they arrive
 * (in bursts) and come out on a steady wall clock at the rate they were
 * recorded, so charts and gauges move smoothly instead of jumping once per batch.
 *
 * - Playback position is in device time (frame.t, from ts_ms), PLAYOUT_DELAY_MS
 *   behind the newest frame. The first release also emits all older history at
 *   once, so connecting to a session fills the charts immediately.
 * - Speed is nudged by up to +/-5% to hold that delay; arrivals are bursty, so
 *   the queue depth naturally swings by about one batch around it.
 * - If data stops, playback holds at the newest frame (no invented samples).
 * - If playback falls more than SNAP_EXTRA_S behind the target, it jumps forward.
 */
export class PlayoutBuffer {
  private readonly delayS: number
  private queue: Frame[] = []
  private newestT = -Infinity
  private playhead: number | null = null
  private lastWallMs = 0

  constructor(delayMs: number = PLAYOUT_DELAY_MS) {
    this.delayS = Math.max(0, delayMs) / 1000
  }

  reset(): void {
    this.queue = []
    this.newestT = -Infinity
    this.playhead = null
    this.lastWallMs = 0
  }

  /** Frames must be in increasing t order across calls (FrameResampler guarantees this). */
  push(frames: Frame[]): void {
    for (const frame of frames) {
      if (!Number.isFinite(frame.t) || frame.t <= this.newestT) continue
      this.queue.push(frame)
      this.newestT = frame.t
    }
  }

  /** Session time of the newest frame received (displayed or not), or null. */
  get newestTime(): number | null {
    return Number.isFinite(this.newestT) ? this.newestT : null
  }

  /** Seconds of received data not yet displayed. */
  get lagSeconds(): number {
    return this.playhead === null || !Number.isFinite(this.newestT) ? 0 : Math.max(0, this.newestT - this.playhead)
  }

  /** Frames whose time has come at wall-clock nowMs, oldest first. */
  release(nowMs: number): Frame[] {
    if (!Number.isFinite(this.newestT)) return []
    const target = this.newestT - this.delayS
    if (this.playhead === null) {
      this.playhead = target
    } else {
      const dt = Math.max(0, (nowMs - this.lastWallMs) / 1000)
      const lag = this.newestT - this.playhead
      if (lag > this.delayS + SNAP_EXTRA_S) {
        this.playhead = target
      } else {
        const adjust = Math.min(MAX_RATE_ADJUST, Math.max(-MAX_RATE_ADJUST, (lag - this.delayS) * RATE_GAIN))
        this.playhead = Math.min(this.newestT, this.playhead + dt * (1 + adjust))
      }
    }
    this.lastWallMs = nowMs

    let n = 0
    while (n < this.queue.length && this.queue[n].t <= this.playhead) n++
    return n === 0 ? [] : this.queue.splice(0, n)
  }
}
