import { describe, expect, it } from 'vitest'
import { emptyFrame } from './live/mapToFrame'
import { makeFrame, LAP_LEN } from './simulation'
import { FrameHistory, lowerBound, sliceByTime } from './history'
import { bestLap, lapBefore, lapsFromFrames, lapsFromMarks } from './laps'
import { DEFAULT_TIME_RANGE, FULL_Y, buildView, clipSeries, frameAtX, panRange, panY, scaleTicks, tracePath, viewBounds, zoomRange, zoomY, type TimeRangeConfig } from './chartView'

const f = (t: number, rpm = t) => ({ ...emptyFrame(), t, rpm })
const range = (patch: Partial<TimeRangeConfig>): TimeRangeConfig => ({ ...DEFAULT_TIME_RANGE, ...patch })
const series10Hz = (seconds: number) => Array.from({ length: seconds * 10 }, (_, i) => f((i + 1) / 10))

describe('FrameHistory', () => {
  it('keeps increasing t, ignores repeats, restarts on a big backwards jump', () => {
    const h = new FrameHistory()
    h.push(f(1)); h.push(f(2)); h.push(f(2)); h.push(f(1.5))
    expect(h.frames.map(x => x.t)).toEqual([1, 2])
    h.push(f(0.1))
    expect(h.frames.map(x => x.t)).toEqual([0.1])
  })

  it('drops the oldest frames beyond the cap and reports truncation', () => {
    const h = new FrameHistory(100)
    for (let i = 1; i <= 250; i++) h.push(f(i))
    expect(h.frames.length).toBeLessThanOrEqual(100)
    expect(h.frames[h.frames.length - 1].t).toBe(250)
    expect(h.truncated).toBe(true)
  })

  it('binary searches by time', () => {
    const frames = series10Hz(5)
    expect(lowerBound(frames, 0.25)).toBe(2)
    expect(sliceByTime(frames, 1, 2).map(x => x.t)).toEqual([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9])
  })
})

describe('laps', () => {
  it('derives lap spans from simulated lapNum/lapTime', () => {
    const frames = Array.from({ length: 2500 }, (_, i) => makeFrame((i + 1) / 10))
    const laps = lapsFromFrames(frames)
    expect(laps.map(l => l.num)).toEqual([1, 2, 3])
    expect(laps[1].start).toBeCloseTo(LAP_LEN, 6)
    expect(laps[0].end).toBeCloseTo(LAP_LEN, 6)
    expect(laps[2].end).toBeNull()
  })

  it('returns no laps for raw CAN frames (NaN lap fields)', () => {
    expect(lapsFromFrames(series10Hz(3))).toEqual([])
  })

  it('builds laps from manual marks; best and previous ignore the lap in progress', () => {
    const laps = lapsFromMarks([100, 10, 55, 55])
    expect(laps).toEqual([{ num: 1, start: 10, end: 55 }, { num: 2, start: 55, end: 100 }, { num: 3, start: 100, end: null }])
    expect(bestLap(laps)?.num).toBe(1)
    expect(lapBefore(laps, laps[2])?.num).toBe(2)
    expect(lapBefore(laps, laps[0])).toBeNull()
  })
})

describe('buildView', () => {
  const history = series10Hz(60)

  it('fixed window shows exactly the last N seconds', () => {
    const v = buildView(history, range({ mode: 'window', windowS: 10 }), [])
    expect(v.xMin).toBeCloseTo(50, 6)
    expect(v.xMax).toBeCloseTo(60, 6)
    const visible = clipSeries(v.series[0], v.xMin, v.xMax).frames
    expect(visible[1].t).toBeCloseTo(50, 6) // one neighbour before the edge is kept for continuity
    expect(visible.at(-1)!.t).toBeCloseTo(60, 6)
  })

  it('session mode spans the whole history', () => {
    const v = buildView(history, range({ mode: 'session' }), [])
    expect(v.xMin).toBeCloseTo(0.1, 6)
    expect(v.series[0].frames.length).toBe(600)
  })

  it('lap mode explains itself when there are no laps', () => {
    const v = buildView(history, range({ mode: 'lap' }), [])
    expect(v.series).toEqual([])
    expect(v.emptyReason).toMatch(/MARK LAP/)
  })

  it('lap mode puts the current lap on lap time with best and previous ghosts', () => {
    const laps = lapsFromMarks([5, 20, 30, 45]) // laps 1 (15 s), 2 (10 s, best), 3 (15 s), 4 in progress
    const v = buildView(history, range({ mode: 'lap', lap: 'current', ghostBest: true, ghostPrev: true }), laps)
    expect(v.series.map(s => [s.role, s.label])).toEqual([
      ['primary', 'LAP 4 (CURRENT)'], ['best', 'BEST · LAP 2'], ['previous', 'PREV · LAP 3'],
    ])
    expect(v.xMin).toBe(0)
    expect(v.xMax).toBeCloseTo(15, 6) // current lap is 15 s in (45 -> 60), previous was 15 s
    expect(v.series[0].frames[0].t - v.series[0].offset).toBeCloseTo(0, 6)
  })

  it('lap mode can show any past lap and does not ghost a lap against itself', () => {
    const laps = lapsFromMarks([5, 20, 30, 45])
    const v = buildView(history, range({ mode: 'lap', lap: 2, ghostBest: true, ghostPrev: true }), laps)
    expect(v.series.map(s => s.label)).toEqual(['LAP 2', 'PREV · LAP 1'])
  })
})

describe('tracePath and lookups', () => {
  const toY = (v: number) => 100 - v

  it('breaks the line at missing values instead of drawing to zero', () => {
    const frames = [f(0, 10), f(1, NaN), f(2, 30)]
    expect(tracePath(frames, x => x.rpm, 0, 0, 2, 100, toY)).toBe('M 0.0 90.0 M 100.0 70.0')
  })

  it('reduces long series to min/max per pixel column and keeps spikes', () => {
    const frames = Array.from({ length: 10_000 }, (_, i) => f(i / 100, i === 5000 ? 99 : 1))
    const d = tracePath(frames, x => x.rpm, 0, 0, 100, 100, toY)
    const points = d.split(/[ML]/).filter(s => s.trim()).length
    expect(points).toBeLessThanOrEqual(200)
    expect(d).toContain(' 1.0') // y for the 99 spike: 100 - 99
  })

  it('finds the nearest frame for the crosshair, honoring the series offset', () => {
    const s = { frames: series10Hz(10), offset: 2, role: 'primary' as const, label: '' }
    expect(frameAtX(s, 1.04)?.t).toBeCloseTo(3, 6)
    expect(frameAtX(s, 50)).toBeNull()
  })

  it('makes five labels across a trace scale', () => {
    expect(scaleTicks(0, 8000)).toEqual([0, 2000, 4000, 6000, 8000])
    expect(scaleTicks(-3, 3)).toEqual([-3, -1.5, 0, 1.5, 3])
  })
})

describe('zoom and pan', () => {
  const bounds = { xMin: 0, xMax: 100 }

  it('zooms around the cursor and keeps that point fixed', () => {
    const r = zoomRange({ xMin: 0, xMax: 100 }, 0.25, 0.5, bounds, 0.5)
    expect(r).toEqual({ xMin: 12.5, xMax: 62.5 })
  })

  it('never zooms out past the data or in past the minimum span', () => {
    expect(zoomRange({ xMin: 40, xMax: 60 }, 0.5, 100, bounds, 0.5)).toEqual({ xMin: 0, xMax: 100 })
    const tight = zoomRange({ xMin: 40, xMax: 41 }, 0.5, 0.01, bounds, 0.5)
    expect(tight.xMax - tight.xMin).toBeCloseTo(0.5, 9)
  })

  it('pans without leaving the data', () => {
    expect(panRange({ xMin: 80, xMax: 90 }, 50, bounds)).toEqual({ xMin: 90, xMax: 100 })
    expect(panRange({ xMin: 10, xMax: 20 }, -50, bounds)).toEqual({ xMin: 0, xMax: 10 })
  })

  it('reports the data extent of a view as zoom bounds', () => {
    const v = buildView(series10Hz(60), range({ mode: 'window', windowS: 10 }), [])
    expect(viewBounds(v).xMin).toBeCloseTo(0.1, 6)
    expect(viewBounds(v).xMax).toBeCloseTo(60, 6)
  })

  it('zooms the vertical scale around the cursor and pans it', () => {
    expect(zoomY(FULL_Y, 0.5, 0.5)).toEqual({ lo: 0.25, hi: 0.75 })
    expect(panY({ lo: 0.25, hi: 0.75 }, 0.1)).toEqual({ lo: 0.35, hi: 0.85 })
  })
})
