import type { Frame } from '../simulation'
import { BUFFER, HZ } from '../simulation'

const BIN_US = 1_000_000 / HZ

/** Bin index on the 10 Hz grid; frame.t is seconds since the session's first sample (from ts_ms). */
export function binOf(tSeconds: number): number {
  return Math.floor(Math.round(tSeconds * 1_000_000) / BIN_US)
}

/**
 * Sample-and-hold resampler. Raw CAN produces one merged-state frame per CAN
 * frame (hundreds per second), while the chart buffer is BUFFER frames at HZ.
 * This closes each 100 ms bin of device time (ts_ms) with the newest state seen
 * inside it, so the buffer covers BUFFER / HZ seconds of real time.
 *
 * - A bin is emitted only once a sample from a later bin arrives, so the newest
 *   <= 100 ms of data is pending until then.
 * - Emitted frames are stamped with the bin's end time ((bin + 1) / HZ).
 * - Bins with no new CAN data repeat the held state (gaps are held, not zeroed).
 * - A gap longer than the buffer emits only the last BUFFER bins; older ones
 *   would be shifted out immediately anyway.
 * - Samples older than the open bin are folded into it (t never moves backward).
 */
export class FrameResampler {
  private bin: number | null = null
  private held: Frame | null = null

  reset(): void {
    this.bin = null
    this.held = null
  }

  push(frame: Frame): Frame[] {
    const t = frame.t
    if (!Number.isFinite(t) || t < 0) return []
    const incoming = binOf(t)
    if (this.bin === null || this.held === null) {
      this.bin = incoming
      this.held = frame
      return []
    }
    const out: Frame[] = []
    if (incoming > this.bin) {
      const first = Math.max(this.bin, incoming - BUFFER)
      for (let b = first; b < incoming; b++) out.push({ ...this.held, t: (b + 1) / HZ })
      this.bin = incoming
    }
    this.held = frame
    return out
  }
}
