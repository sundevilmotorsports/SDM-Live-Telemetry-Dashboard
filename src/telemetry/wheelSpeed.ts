import type { Frame } from './simulation'

export const WHEEL_REFERENCE_DESCRIPTION = 'Estimated vehicle speed from wheel speeds (km/h). Above 5 km/h, readings below half the upper median are excluded as possible lockup; the remaining readings are combined using a median. Requires at least two valid wheel readings. Not ground speed: multiple spinning wheels or all-wheel lockup can mislead it. No tyre-size or cornering correction is applied.'

/** A lockup-resistant reference, not a replacement for the measured wheel speeds. */
export function wheelReferenceSpeed(frame: Pick<Frame, 'wFL' | 'wFR' | 'wRL' | 'wRR'>): number {
  const speeds = [frame.wFL, frame.wFR, frame.wRL, frame.wRR]
    .filter(speed => Number.isFinite(speed) && speed >= 0)
    .sort((a, b) => a - b)
  if (speeds.length < 2) return NaN

  // The upper median permits two locked wheels out of four, without following
  // a single high outlier. Below walking speed, preserve real stop/crawl readings.
  const upperMedian = speeds[Math.floor(speeds.length / 2)]
  const rolling = upperMedian >= 5 ? speeds.filter(speed => speed >= upperMedian * 0.5) : speeds
  if (rolling.length < 2) return NaN
  const middle = Math.floor(rolling.length / 2)
  return rolling.length % 2 ? rolling[middle] : (rolling[middle - 1] + rolling[middle]) / 2
}
