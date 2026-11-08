import { describe, expect, it } from 'vitest'
import { RestZeroer, baselineAt, deltaUnit, zeroedValue } from './zeroing'
import { convertValue, resolveUnit } from './units'

const KEYS = ['damper']

/** Drive the zeroer at 10 Hz: [fromT, toT) at rest or not, with a value function. */
function run(z: RestZeroer, fromT: number, toT: number, atRest: boolean, value: (t: number) => number, holdS = 3) {
  for (let i = Math.round(fromT * 10); i < Math.round(toT * 10); i++) {
    const t = i / 10
    z.update(t, atRest, { damper: value(t) }, KEYS, holdS)
  }
}

describe('RestZeroer', () => {
  it('reads as-is while driving, then the pit reading becomes the baseline', () => {
    const z = new RestZeroer()
    run(z, 0, 60, false, t => 30 + Math.sin(t) * 10) // stint 1: no baseline yet
    expect(z.baselines.damper).toBeUndefined()
    run(z, 60, 62, true, () => 25) // in the pit, but not for 3 s yet
    expect(z.baselines.damper).toBeUndefined()
    run(z, 62, 70, true, () => 25)
    expect(z.baselines.damper).toEqual([{ fromT: 60, value: 25 }])
    run(z, 70, 120, false, () => 40) // stint 2: baseline frozen
    expect(baselineAt(z.baselines.damper, 100)).toBe(25)
    expect(zeroedValue(40, z.baselines.damper, 100)).toEqual({ value: 15, zeroed: true })
  })

  it('keeps each stop’s baseline for its own part of the history', () => {
    const z = new RestZeroer()
    run(z, 0, 5, true, () => 20)
    run(z, 5, 50, false, () => 30)
    run(z, 50, 55, true, () => 22) // second pit stop: new baseline
    expect(z.baselines.damper.map(s => [s.fromT, s.value])).toEqual([[0, 20], [50, 22]])
    expect(baselineAt(z.baselines.damper, 30)).toBe(20) // stint 1 history unchanged by the later stop
    expect(baselineAt(z.baselines.damper, 52)).toBe(22)
    expect(baselineAt(z.baselines.damper, -1)).toBeNull()
  })

  it('uses the mean over the whole stop, so settling noise averages out', () => {
    const z = new RestZeroer()
    run(z, 0, 4, true, t => (Math.round(t * 10) % 2 === 0 ? 24 : 26))
    expect(z.baselines.damper[0].value).toBeCloseTo(25, 6)
  })

  it('a brief stop shorter than the hold time does not re-zero', () => {
    const z = new RestZeroer()
    run(z, 0, 2, true, () => 10)
    run(z, 2, 3, false, () => 30)
    run(z, 3, 5, true, () => 50)
    expect(z.baselines.damper).toBeUndefined()
  })

  it('ignores channels that are not enabled, missing values, and time going backward', () => {
    const z = new RestZeroer()
    for (let i = 0; i < 40; i++) z.update(i / 10, true, { damper: NaN, other: 5 }, KEYS, 3)
    expect(z.baselines).toEqual({})
    expect(z.update(1, true, { damper: 1 }, KEYS, 3)).toBe(false)
  })

  it('zero now and clear', () => {
    const z = new RestZeroer()
    run(z, 0, 10, false, () => 30)
    expect(z.zeroNow(10, { damper: 31 }, KEYS)).toBe(true)
    expect(z.baselines.damper).toEqual([{ fromT: 10, value: 31 }])
    expect(z.zeroNow(10, { damper: NaN }, KEYS)).toBe(false)
    expect(z.clear('damper')).toBe(true)
    expect(z.baselines.damper).toBeUndefined()
    expect(z.clear('damper')).toBe(false)
  })

  it('reset forgets everything (new session)', () => {
    const z = new RestZeroer()
    run(z, 0, 5, true, () => 20)
    z.reset()
    expect(z.baselines).toEqual({})
    expect(z.restStartedAt).toBeNull()
  })
})

describe('zeroed values and units', () => {
  it('converts a zeroed value as a difference (no unit offset)', () => {
    const f = resolveUnit('°C', '°F')
    expect(convertValue(2, deltaUnit(f))).toBeCloseTo(3.6, 9)
    expect(convertValue(2, f)).toBeCloseTo(35.6, 9)
    const mm = resolveUnit('mm', 'in')
    expect(convertValue(25.4, deltaUnit(mm))).toBeCloseTo(1, 6)
  })

  it('NaN stays NaN', () => {
    expect(zeroedValue(NaN, [{ fromT: 0, value: 5 }], 1).value).toBeNaN()
    expect(zeroedValue(7, undefined, 1)).toEqual({ value: 7, zeroed: false })
  })
})
