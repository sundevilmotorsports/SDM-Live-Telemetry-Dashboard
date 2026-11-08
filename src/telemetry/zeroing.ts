import type { UnitDef } from './units'

/**
 * Re-zero (tare) at rest. Damper position is read as-is while driving; when the car
 * is at rest (e.g. in the pit), the reading there becomes the new baseline and later
 * values are shown relative to it, until the next stop sets a new one.
 *
 * Baselines are a timeline per channel key, so history keeps the baseline that was in
 * effect at the time (an earlier stint is not shifted by a later pit stop). Display only:
 * stored data, alerts, and math channels always use the raw value.
 */
export interface BaselineSegment {
  /** Session time (Frame.t) from which this baseline applies: the start of the stop. */
  fromT: number
  value: number
}
export type Baselines = Record<string, BaselineSegment[]>

/** Channel keys auto-zeroed by default: damper/suspension position wherever a source provides it. */
export const DEFAULT_AUTO_ZERO = [
  'suspension.travel_fl', 'suspension.travel_fr', 'suspension.travel_rl', 'suspension.travel_rr',
  'raw:l_FL_damper', 'raw:l_FR_damper', 'raw:l_RL_damper', 'raw:l_RR_damper',
]
/**
 * Engine off (below any idle). Raw CAN maps engine rpm (r_engine) but no vehicle speed.
 * Does not trigger if the engine idles in the pit; use e.g. `rpm < 500 || gear == 0` for that.
 */
export const DEFAULT_REST_CONDITION = 'rpm < 500'
/** Earlier default, replaced on load so saved configs pick up the rpm rule. */
export const OLD_DEFAULT_REST_CONDITION = 'speed < 1'
export const DEFAULT_REST_HOLD_S = 3

/** The baseline in effect at session time t, or null before the first one (read as-is). */
export function baselineAt(segments: BaselineSegment[] | undefined, t: number): number | null {
  if (!segments || !Number.isFinite(t)) return null
  for (let i = segments.length - 1; i >= 0; i--) if (t >= segments[i].fromT) return segments[i].value
  return null
}

/**
 * Value relative to the baseline in effect at t. A zeroed value is a difference, so a
 * unit conversion must drop its offset (a 2 °C rise is 3.6 °F, not 35.6 °F).
 */
export function zeroedValue(base: number, segments: BaselineSegment[] | undefined, t: number): { value: number; zeroed: boolean } {
  const b = baselineAt(segments, t)
  return b === null ? { value: base, zeroed: false } : { value: base - b, zeroed: true }
}

export function deltaUnit(unit: UnitDef): UnitDef {
  return { ...unit, offset: 0 }
}

/**
 * Tracks rest periods and captures baselines. Feed it once per new frame with whether
 * the rest condition holds and the current base-unit value of each channel. After the
 * car has been at rest for holdS seconds, each enabled channel's baseline becomes the
 * mean of its readings since the stop began, and keeps refining while it stays at rest.
 */
export class RestZeroer {
  baselines: Baselines = {}
  private restStart: number | null = null
  private lastT: number | null = null
  private sums = new Map<string, { sum: number; n: number }>()

  reset(): void {
    this.baselines = {}
    this.restStart = null
    this.lastT = null
    this.sums.clear()
  }

  /** Session time at which the current rest period began, or null if not at rest. */
  get restStartedAt(): number | null {
    return this.restStart
  }

  /** Returns true if any baseline changed. */
  update(t: number, atRest: boolean, values: Record<string, number>, keys: readonly string[], holdS: number): boolean {
    if (!Number.isFinite(t) || (this.lastT !== null && t <= this.lastT)) return false
    this.lastT = t
    if (!atRest) {
      this.restStart = null
      this.sums.clear()
      return false
    }
    if (this.restStart === null) {
      this.restStart = t
      this.sums.clear()
    }
    for (const key of keys) {
      const v = values[key]
      if (!Number.isFinite(v)) continue
      const acc = this.sums.get(key) ?? { sum: 0, n: 0 }
      acc.sum += v
      acc.n++
      this.sums.set(key, acc)
    }
    if (t - this.restStart < holdS) return false
    let changed = false
    for (const key of keys) {
      const acc = this.sums.get(key)
      if (!acc || acc.n === 0) continue
      changed = this.setBaseline(key, this.restStart, acc.sum / acc.n) || changed
    }
    return changed
  }

  /** Zero now: the current value becomes the baseline from time t. */
  zeroNow(t: number, values: Record<string, number>, keys: readonly string[]): boolean {
    if (!Number.isFinite(t)) return false
    let changed = false
    for (const key of keys) {
      if (Number.isFinite(values[key])) changed = this.setBaseline(key, t, values[key]) || changed
    }
    return changed
  }

  /** Forget a channel's baselines (back to as-is for the whole session). */
  clear(key: string): boolean {
    if (!this.baselines[key]) return false
    const next = { ...this.baselines }
    delete next[key]
    this.baselines = next
    return true
  }

  private setBaseline(key: string, fromT: number, value: number): boolean {
    const segments = this.baselines[key] ?? []
    const last = segments[segments.length - 1]
    let next: BaselineSegment[]
    if (last && last.fromT === fromT) {
      if (last.value === value) return false
      next = [...segments.slice(0, -1), { fromT, value }]
    } else {
      // A new stop (or manual zero) supersedes anything recorded from a later time.
      next = [...segments.filter(s => s.fromT < fromT), { fromT, value }]
    }
    this.baselines = { ...this.baselines, [key]: next }
    return true
  }
}
