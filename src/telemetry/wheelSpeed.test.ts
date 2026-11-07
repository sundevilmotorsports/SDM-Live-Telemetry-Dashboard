import { describe, expect, it } from 'vitest'
import { wheelReferenceSpeed } from './wheelSpeed'
import { CHANNEL_MAP, frameScope, makeFrame } from './simulation'

const reference = (wFL: number, wFR: number, wRL: number, wRR: number) => wheelReferenceSpeed({ wFL, wFR, wRL, wRR })

describe('wheel reference speed estimate', () => {
  it('uses a median rather than a simple average of all wheels', () => {
    expect(reference(79, 81, 80, 82)).toBe(80.5)
    expect(reference(0, 80, 80, 80)).toBe(80)
  })

  it('excludes a heavily slowed wheel and handles both fronts locking', () => {
    expect(reference(10, 80, 80, 80)).toBe(80)
    expect(reference(0, 0, 79, 81)).toBe(80)
  })

  it('does not follow one spinning wheel when the other three agree', () => {
    expect(reference(80, 80, 80, 160)).toBe(80)
    expect(reference(0, 0, 0, 160)).toBe(0)
  })

  it('retains normal corner-to-corner differences', () => {
    expect(reference(70, 80, 72, 82)).toBe(76)
  })

  it('preserves stop and crawl readings instead of imposing a minimum speed', () => {
    expect(reference(0, 0, 0, 0)).toBe(0)
    expect(reference(0, 1, 2, 3)).toBe(1.5)
  })

  it('ignores missing, negative and non-finite inputs without treating them as zero', () => {
    expect(reference(NaN, 79, 81, Infinity)).toBe(80)
    expect(reference(-1, 79, 81, NaN)).toBe(80)
    expect(reference(NaN, NaN, NaN, 80)).toBeNaN()
    expect(reference(NaN, NaN, NaN, NaN)).toBeNaN()
  })

  it('requires at least two retained readings after rejecting possible lockup', () => {
    expect(reference(0, 80, NaN, NaN)).toBeNaN()
  })

  it('cannot distinguish all-wheel lockup from a stopped car', () => {
    expect(reference(0, 0, 0, 0)).toBe(0)
  })

  it('is exposed as a derived channel without replacing raw measurements', () => {
    const frame = { ...makeFrame(0), wFL: 0, wFR: 0, wRL: 80, wRR: 80 }
    expect(CHANNEL_MAP.wheelRef.get(frame)).toBe(80)
    expect(frameScope(frame).wheelRef).toBe(80)
    expect(CHANNEL_MAP.wFL.get(frame)).toBe(0)
    expect(frame.wFL).toBe(0)
  })
})
