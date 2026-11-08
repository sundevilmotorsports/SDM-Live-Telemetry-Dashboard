/**
 * Pure sizing math for resizable panels. Sizes live in config as `panelSizes` (part of each
 * profile's layout). Two kinds:
 *  - pixel sizes for fixed-size panels (channel list width, timing panel width, dock height)
 *  - weights for neighbours that share space (flex weights), resized as a pair so everything
 *    else keeps its size
 * Keys: `channelList`, `timing`, `pedal`, `alertDock` (px); `split.main` (left share 0..1);
 * `c.<chartId>`, `w.<widgetId>`, `g.<gaugeId>`, `bottom.gforce|gps`, `steer.steering|fuel` (weights).
 */
export type PanelSizes = Record<string, number>

export const MAX_SIZE_KEYS = 300

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}

/** Stored sizes from any source (saved config, imported profile): drop anything that is not a sane finite number. */
export function sanitizePanelSizes(raw: unknown): PanelSizes {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PanelSizes = {}
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_SIZE_KEYS) break
    if (key.length <= 80 && typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100_000) out[key] = value
  }
  return out
}

/** Apply a patch: a number sets a size, null removes it (back to the default). Invalid values are ignored. */
export function applySizePatch(sizes: PanelSizes, patch: Record<string, number | null>): PanelSizes {
  const next = { ...sizes }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else if (Number.isFinite(value) && value > 0 && value < 100_000) next[key] = value
  }
  return next
}

/**
 * Move the boundary between two neighbours by deltaPx. a and b are their current pixel sizes
 * and weights; the pair keeps its total weight, so every other panel's size is unchanged.
 * Neither side may shrink below minPx (if the pair cannot fit two minimums, the split is
 * centred instead).
 */
export function pairWeights(wa: number, wb: number, aPx: number, bPx: number, deltaPx: number, minPx: number): [number, number] {
  const totalPx = aPx + bPx
  const totalW = wa + wb
  if (!(totalPx > 0) || !(totalW > 0)) return [wa, wb]
  const aNew = totalPx < minPx * 2 ? totalPx / 2 : clamp(aPx + deltaPx, minPx, totalPx - minPx)
  const share = aNew / totalPx
  // Keep both weights positive so a panel can never collapse to nothing.
  const floor = totalW * 0.01
  const a = clamp(totalW * share, floor, totalW - floor)
  return [a, totalW - a]
}
