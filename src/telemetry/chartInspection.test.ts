import { describe, expect, it } from 'vitest'
import { inspectChart, type ChartView } from './chartView'
import { emptyFrame } from './live/mapToFrame'

const frame = (t: number, fuel: number) => ({ ...emptyFrame(), t, fuel })
const view = (frames = [frame(10, 90), frame(11, 80), frame(12, 70)]): ChartView => ({
  xMin: 10, xMax: 12, caption: 'SESSION', emptyReason: null,
  series: [{ frames, offset: 0, role: 'primary', label: 'SESSION' }],
})

describe('time-linked chart inspection', () => {
  it('follows the cursor sample rather than the live fuel reading', () => {
    const selected = inspectChart(view(), { xMin: 10, xMax: 12 }, 0.5)
    expect(selected.mode).toBe('cursor')
    expect(selected.frame).toMatchObject({ t: 11, fuel: 80 })
  })

  it('uses the visible right edge when panned back without a cursor', () => {
    const selected = inspectChart(view(), { xMin: 10, xMax: 11 }, null)
    expect(selected.mode).toBe('view-end')
    expect(selected.frame).toMatchObject({ t: 11, fuel: 80 })
  })

  it('returns to the latest sample when the view follows live data', () => {
    expect(inspectChart(view(), { xMin: 10, xMax: 12 }, null).frame?.fuel).toBe(70)
  })

  it('uses selected-lap time offsets and never reads fuel from a ghost lap', () => {
    const lapView: ChartView = {
      xMin: 0, xMax: 20, caption: 'LAP 2', emptyReason: null,
      series: [
        { frames: [frame(1, 99)], offset: 0, role: 'best', label: 'BEST' },
        { frames: [frame(101, 40), frame(102, 35)], offset: 100, role: 'primary', label: 'LAP 2' },
      ],
    }
    const selected = inspectChart(lapView, { xMin: 0, xMax: 2 }, 0.5)
    expect(selected).toMatchObject({ label: 'LAP 2', frame: { t: 101, fuel: 40 } })
    // A longer ghost lap must not replace or erase the selected lap's end reading.
    expect(inspectChart(lapView, { xMin: 0, xMax: 20 }, null).frame?.fuel).toBe(35)
  })

  it('leaves unavailable fuel unavailable instead of searching for an older valid value', () => {
    const selected = inspectChart(view([frame(10, 90), frame(11, NaN)]), { xMin: 10, xMax: 11 }, null)
    expect(selected.frame?.fuel).toBeNaN()
  })

  it('returns no sample for empty views, data gaps, or ranges beyond the selected lap', () => {
    expect(inspectChart(view([]), { xMin: 0, xMax: 1 }, null).frame).toBeNull()
    expect(inspectChart(view([frame(10, 90), frame(20, 80)]), { xMin: 10, xMax: 20 }, 0.5).frame).toBeNull()
    expect(inspectChart(view(), { xMin: 20, xMax: 30 }, null).frame).toBeNull()
  })

  it('clamps pointer fractions to the visible range', () => {
    expect(inspectChart(view(), { xMin: 10, xMax: 12 }, -1).frame?.t).toBe(10)
    expect(inspectChart(view(), { xMin: 10, xMax: 12 }, 2).frame?.t).toBe(12)
  })
})
