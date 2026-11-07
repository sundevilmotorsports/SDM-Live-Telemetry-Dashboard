import type { Frame } from './simulation'
import { lowerBound, sliceByTime } from './history'
import { type LapSpan, bestLap, lapBefore, lapLength } from './laps'

export type RangeMode = 'window' | 'session' | 'lap'

export interface TimeRangeConfig {
  mode: RangeMode
  /** Fixed-window length in seconds. */
  windowS: number
  /** Lap to show in lap mode: the lap in progress, or a lap number. */
  lap: 'current' | number
  ghostBest: boolean
  ghostPrev: boolean
}

export const DEFAULT_TIME_RANGE: TimeRangeConfig = { mode: 'window', windowS: 18, lap: 'current', ghostBest: true, ghostPrev: false }
export const WINDOW_PRESETS_S = [10, 18, 30, 60, 120, 300]

export type SeriesRole = 'primary' | 'best' | 'previous'

/** One run of frames drawn on a chart; x = frame.t - offset. */
export interface ViewSeries {
  frames: Frame[]
  offset: number
  role: SeriesRole
  label: string
}

export interface ChartView {
  xMin: number
  xMax: number
  series: ViewSeries[]
  /** Human-readable description of what the x-axis covers. */
  caption: string
  /** Set when the mode cannot show data yet (e.g. lap mode with no laps). */
  emptyReason: string | null
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--'
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = (s % 60).toFixed(1).padStart(4, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

/** Decide which frames each chart shows and over what x range, for the shared time range setting. */
export function buildView(history: Frame[], range: TimeRangeConfig, laps: LapSpan[]): ChartView {
  const newest = history.length ? history[history.length - 1].t : NaN
  const windowS = Number.isFinite(range.windowS) && range.windowS > 0 ? range.windowS : DEFAULT_TIME_RANGE.windowS

  if (range.mode === 'window' || !Number.isFinite(newest)) {
    if (!Number.isFinite(newest)) {
      return { xMin: 0, xMax: windowS, series: [], caption: `LAST ${windowS}s`, emptyReason: null }
    }
    const start = newest - windowS
    // The full history is attached so zooming out can reveal earlier data;
    // drawing clips to the visible range (clipSeries).
    return {
      xMin: start, xMax: newest,
      series: [{ frames: history, offset: 0, role: 'primary', label: 'LIVE' }],
      caption: `LAST ${windowS}s`, emptyReason: null,
    }
  }

  if (range.mode === 'session') {
    const first = history[0].t
    return {
      xMin: first, xMax: Math.max(newest, first + 1),
      series: [{ frames: history, offset: 0, role: 'primary', label: 'SESSION' }],
      caption: `WHOLE SESSION · ${fmtDuration(newest - first)}`, emptyReason: null,
    }
  }

  // Lap mode
  if (laps.length === 0) {
    return { xMin: 0, xMax: 60, series: [], caption: 'LAP', emptyReason: 'NO LAPS YET — PRESS MARK LAP AS THE CAR CROSSES THE LINE' }
  }
  const selected = range.lap === 'current'
    ? laps[laps.length - 1]
    : laps.find(l => l.num === range.lap) ?? laps[laps.length - 1]
  const series: ViewSeries[] = [{
    frames: sliceByTime(history, selected.start, selected.end ?? Infinity),
    offset: selected.start, role: 'primary',
    label: `LAP ${selected.num}${selected.end === null ? ' (CURRENT)' : ''}`,
  }]
  let xMax = lapLength(selected, newest)
  const best = range.ghostBest ? bestLap(laps) : null
  const prev = range.ghostPrev ? lapBefore(laps, selected) : null
  const ghosts: [LapSpan | null, SeriesRole, string][] = [
    [best && best.num !== selected.num ? best : null, 'best', 'BEST'],
    [prev && prev.num !== selected.num && prev.num !== best?.num ? prev : null, 'previous', 'PREV'],
  ]
  for (const [lap, role, tag] of ghosts) {
    if (!lap) continue
    series.push({ frames: sliceByTime(history, lap.start, lap.end ?? Infinity), offset: lap.start, role, label: `${tag} · LAP ${lap.num}` })
    xMax = Math.max(xMax, lapLength(lap, newest))
  }
  const len = lapLength(selected, newest)
  return {
    xMin: 0, xMax: Math.max(xMax, 1), series,
    caption: `LAP ${selected.num} · ${fmtDuration(len)}${selected.end === null ? ' (IN PROGRESS)' : ''}`,
    emptyReason: null,
  }
}

/**
 * SVG path for one trace. Long series are reduced to the min and max of each
 * pixel column (spikes survive, cost stays ~2 points per column). Non-finite
 * values break the line instead of drawing to zero.
 */
export function tracePath(
  frames: Frame[], get: (f: Frame) => number, offset: number,
  xMin: number, xMax: number, width: number, toY: (v: number) => number,
): string {
  if (frames.length === 0) return ''
  const span = xMax - xMin || 1
  const toX = (t: number) => ((t - offset - xMin) / span) * width
  const parts: string[] = []
  let pen = false
  const point = (x: number, v: number) => {
    parts.push(`${pen ? 'L' : 'M'} ${x.toFixed(1)} ${toY(v).toFixed(1)}`)
    pen = true
  }

  if (frames.length <= width * 2) {
    for (const f of frames) {
      const v = get(f)
      if (!Number.isFinite(v)) { pen = false; continue }
      point(toX(f.t), v)
    }
    return parts.join(' ')
  }

  // Per pixel column: emit the min and max in the order they occurred.
  let col = Number.NaN
  let lo = Infinity, hi = -Infinity, loAt = 0, hiAt = 0, count = 0, gap = false
  const flush = () => {
    if (count > 0) {
      const x = col + 0.5
      if (lo === hi) point(x, lo)
      else if (loAt <= hiAt) { point(x, lo); point(x, hi) }
      else { point(x, hi); point(x, lo) }
    }
    if (gap) pen = false
  }
  frames.forEach((f, k) => {
    const c = Math.floor(toX(f.t))
    if (c !== col) {
      flush()
      col = c; lo = Infinity; hi = -Infinity; count = 0; gap = false
    }
    const v = get(f)
    if (!Number.isFinite(v)) { gap = true; return }
    if (v < lo) { lo = v; loAt = k }
    if (v > hi) { hi = v; hiAt = k }
    count++
  })
  flush()
  return parts.join(' ')
}

/** Frame nearest to x (in series coordinates), or null if none within maxGapS. */
export function frameAtX(series: ViewSeries, x: number, maxGapS = 1): Frame | null {
  const { frames } = series
  if (frames.length === 0) return null
  const t = x + series.offset
  const i = lowerBound(frames, t)
  const candidates = [frames[i - 1], frames[i]].filter((f): f is Frame => f !== undefined)
  let best: Frame | null = null
  for (const f of candidates) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f
  return best && Math.abs(best.t - t) <= maxGapS ? best : null
}

export interface ChartInspection {
  frame: Frame | null
  label: string
  mode: 'cursor' | 'view-end'
}

/** Shared sample for chart readouts and time-linked widgets; never use a ghost lap. */
export function inspectChart(view: ChartView, range: XRange, crossFrac: number | null): ChartInspection {
  const primary = view.series.find(series => series.role === 'primary')
  const mode = crossFrac === null ? 'view-end' : 'cursor'
  const result: ChartInspection = { frame: null, label: primary?.label ?? 'NO DATA', mode }
  if (!primary?.frames.length) return result
  const lastX = primary.frames[primary.frames.length - 1].t - primary.offset
  const x = crossFrac === null ? Math.min(range.xMax, lastX)
    : range.xMin + Math.max(0, Math.min(1, crossFrac)) * (range.xMax - range.xMin)
  if (x < range.xMin || x > range.xMax) return result
  return { ...result, frame: frameAtX(primary, x) }
}

/** Five evenly spaced scale labels for a trace's own min/max. */
export function scaleTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return [min]
  const step = (max - min) / (count - 1)
  const decimals = Math.abs(step) >= 10 ? 0 : Math.abs(step) >= 1 ? 1 : 2
  return Array.from({ length: count }, (_, i) => Number((min + step * i).toFixed(decimals)))
}

// ── Zoom / pan ───────────────────────────────────────────────────────────────
export interface XRange { xMin: number; xMax: number }

/**
 * Zoom [xMin, xMax] by `factor` (< 1 zooms in) keeping the point at `anchorFrac`
 * (0 = left edge, 1 = right edge) fixed, clamped to `bounds` and at least `minSpan` wide.
 */
export function zoomRange(r: XRange, anchorFrac: number, factor: number, bounds: XRange, minSpan: number): XRange {
  const span = r.xMax - r.xMin
  const boundSpan = Math.max(bounds.xMax - bounds.xMin, minSpan)
  const nextSpan = Math.min(Math.max(span * factor, minSpan), boundSpan)
  const a = Math.min(Math.max(anchorFrac, 0), 1)
  const anchor = r.xMin + a * span
  return clampRange({ xMin: anchor - a * nextSpan, xMax: anchor - a * nextSpan + nextSpan }, bounds)
}

/** Shift a range by `delta` (x units) without leaving `bounds`. */
export function panRange(r: XRange, delta: number, bounds: XRange): XRange {
  return clampRange({ xMin: r.xMin + delta, xMax: r.xMax + delta }, bounds)
}

function clampRange(r: XRange, bounds: XRange): XRange {
  const span = r.xMax - r.xMin
  if (bounds.xMax - bounds.xMin <= span) return { xMin: bounds.xMin, xMax: bounds.xMin + span }
  if (r.xMin < bounds.xMin) return { xMin: bounds.xMin, xMax: bounds.xMin + span }
  if (r.xMax > bounds.xMax) return { xMin: bounds.xMax - span, xMax: bounds.xMax }
  return r
}

/** Only the frames inside [xMin, xMax] (series coordinates) plus one neighbour each side, so lines reach the edges. */
export function clipSeries(series: ViewSeries, xMin: number, xMax: number): ViewSeries {
  const { frames, offset } = series
  if (frames.length === 0) return series
  const lo = Math.max(0, lowerBound(frames, xMin + offset) - 1)
  const hi = Math.min(frames.length, lowerBound(frames, xMax + offset) + 1)
  return lo === 0 && hi === frames.length ? series : { ...series, frames: frames.slice(lo, hi) }
}

/** Data extent of a view in x (used as zoom/pan bounds). */
export function viewBounds(view: ChartView): XRange {
  let xMin = view.xMin
  let xMax = view.xMax
  for (const s of view.series) {
    if (!s.frames.length) continue
    xMin = Math.min(xMin, s.frames[0].t - s.offset)
    xMax = Math.max(xMax, s.frames[s.frames.length - 1].t - s.offset)
  }
  return { xMin, xMax }
}

/** Vertical zoom of a chart as a window [lo, hi] over each trace's configured scale (0..1 = configured min..max). */
export interface YWindow { lo: number; hi: number }
export const FULL_Y: YWindow = { lo: 0, hi: 1 }

export function zoomY(w: YWindow, anchorFrac: number, factor: number): YWindow {
  const span = Math.min(Math.max((w.hi - w.lo) * factor, 0.01), 20)
  const a = Math.min(Math.max(anchorFrac, 0), 1)
  const anchor = w.lo + a * (w.hi - w.lo)
  return { lo: anchor - a * span, hi: anchor - a * span + span }
}

export function panY(w: YWindow, deltaFrac: number): YWindow {
  return { lo: w.lo + deltaFrac, hi: w.hi + deltaFrac }
}
