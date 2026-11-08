/**
 * Warning card formats, richest to most compact. The dock picks the richest format in which
 * every card fits at the dock's current size, so shrinking it re-formats the cards instead of
 * cutting them off:
 *   full     header + message + time row (what the dock shows by default)
 *   compact  two lines: kind and message, then the times
 *   line     one line: message, elapsed time
 *   chip     one short line: message and elapsed time (the densest; scrolls if even this overflows)
 * Elapsed time is shown in every format; only the message shortens.
 */
export type AlertDensity = 'full' | 'compact' | 'line' | 'chip'

export const DENSITIES: AlertDensity[] = ['full', 'compact', 'line', 'chip']

/** Card height, minimum card width, and whether the "WARNINGS · N ACTIVE" header row is shown. */
export const DENSITY_SPEC: Record<AlertDensity, { cardH: number; minW: number; header: boolean; padV: number; padH: number }> = {
  full: { cardH: 76, minW: 240, header: true, padV: 14, padH: 10 },
  compact: { cardH: 40, minW: 220, header: false, padV: 10, padH: 8 },
  line: { cardH: 24, minW: 190, header: false, padV: 8, padH: 8 },
  chip: { cardH: 20, minW: 130, header: false, padV: 8, padH: 8 },
}

export const CARD_GAP = 6
export const HEADER_H = 18

/** Height needed to show `count` cards in this format at this dock width, without scrolling. */
export function requiredHeight(density: AlertDensity, count: number, widthPx: number): number {
  const s = DENSITY_SPEC[density]
  if (count <= 0) return 0
  const columns = Math.max(1, Math.floor((widthPx - 2 * s.padH + CARD_GAP) / (s.minW + CARD_GAP)))
  const rows = Math.ceil(count / columns)
  return (s.header ? HEADER_H : 0) + rows * s.cardH + (rows - 1) * CARD_GAP + s.padV
}

/** Richest format that fits every card; the densest format when none does. */
export function pickDensity(heightPx: number, widthPx: number, count: number): AlertDensity {
  for (const density of DENSITIES) if (requiredHeight(density, count, widthPx) <= heightPx) return density
  return 'chip'
}
