import type { ChannelState } from './live/types'

export interface ChannelStat {
  id: string
  value: number
  /** Device time of the newest sample, Unix microseconds. */
  tUs: number
  receivedAtMs: number
  /** Measured samples per second of device time; null until two samples have been seen. */
  rateHz: number | null
  /** True while a new sample has arrived recently enough (see isActive). */
  active: boolean
}

interface Entry { tUs: number; emaDtUs: number | null }

const EMA_ALPHA = 0.2
/** A channel is allowed to be silent for this many of its own sample periods before it counts as gone. */
const PERIODS_BEFORE_INACTIVE = 3

/**
 * Per-channel sample rate from device timestamps. Feed it every accepted sample
 * (before any resampling, which would flatten every rate to the chart rate).
 * The rate is an exponential average of the interval between consecutive samples,
 * so slow channels settle after a few samples and bursty batch delivery does not
 * matter: only device time is used.
 */
export class ChannelActivityTracker {
  private entries = new Map<string, Entry>()

  reset(): void {
    this.entries.clear()
  }

  /** Idempotent: re-observing the same state counts nothing. */
  observe(state: ChannelState): void {
    for (const id in state) {
      const tUs = state[id].tUs
      if (!Number.isFinite(tUs)) continue
      const entry = this.entries.get(id)
      if (!entry) {
        this.entries.set(id, { tUs, emaDtUs: null })
        continue
      }
      if (tUs <= entry.tUs) continue
      const dt = tUs - entry.tUs
      entry.emaDtUs = entry.emaDtUs === null ? dt : entry.emaDtUs * (1 - EMA_ALPHA) + dt * EMA_ALPHA
      entry.tUs = tUs
    }
  }

  rateHz(id: string): number | null {
    const dt = this.entries.get(id)?.emaDtUs
    return dt != null && dt > 0 ? 1_000_000 / dt : null
  }

  /**
   * Receiving = a sample was accepted within max(staleAfterMs, 3 sample periods).
   * Wall-clock receipt time is used, so a channel that stops (or a stored,
   * historical session) goes inactive even though its last value is still held.
   */
  stats(state: ChannelState, nowMs: number, staleAfterMs: number): ChannelStat[] {
    return Object.entries(state).map(([id, sample]) => {
      const rateHz = this.rateHz(id)
      const periodMs = rateHz ? 1000 / rateHz : 0
      const window = Math.max(staleAfterMs, PERIODS_BEFORE_INACTIVE * periodMs)
      return {
        id, value: sample.value, tUs: sample.tUs, receivedAtMs: sample.receivedAtMs, rateHz,
        active: Number.isFinite(sample.value) && nowMs - sample.receivedAtMs <= window,
      }
    })
  }
}
