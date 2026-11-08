import { describe, expect, it } from 'vitest'
import { applySizePatch, clamp, pairWeights, sanitizePanelSizes } from './panelSizes'

describe('pairWeights', () => {
  it('moves the boundary and keeps the pair total', () => {
    // 300 px | 100 px with weights 3:1; drag 50 px right
    const [a, b] = pairWeights(3, 1, 300, 100, 50, 40)
    expect(a + b).toBeCloseTo(4, 12)
    expect(a / (a + b)).toBeCloseTo(350 / 400, 12)
  })

  it('respects the minimum on both sides', () => {
    const [a, b] = pairWeights(1, 1, 200, 200, 10_000, 60)
    expect(b / (a + b)).toBeCloseTo(60 / 400, 12) // right side stops at 60 px
    const [c, d] = pairWeights(1, 1, 200, 200, -10_000, 60)
    expect(c / (c + d)).toBeCloseTo(60 / 400, 12)
  })

  it('centres the split when two minimums do not fit, and never produces a non-positive weight', () => {
    const [a, b] = pairWeights(2, 6, 30, 50, 5, 60)
    expect(a / (a + b)).toBeCloseTo(0.5, 12)
    expect(pairWeights(1, 1, 100, 100, 1e9, 0).every(w => w > 0)).toBe(true)
    expect(pairWeights(1, 1, 100, 100, -1e9, 0).every(w => w > 0)).toBe(true)
  })

  it('leaves weights alone when sizes are unmeasurable', () => {
    expect(pairWeights(1, 2, 0, 0, 10, 10)).toEqual([1, 2])
    expect(pairWeights(0, 0, 100, 100, 10, 10)).toEqual([0, 0])
  })

  it('is a no-op for zero delta', () => {
    const [a, b] = pairWeights(3, 1, 300, 100, 0, 40)
    expect(a / b).toBeCloseTo(3, 12)
  })
})

describe('size storage', () => {
  it('sanitizes stored sizes', () => {
    expect(sanitizePanelSizes({ channelList: 200, bad: 'x', neg: -1, zero: 0, nan: NaN, inf: Infinity, huge: 1e9, [`${'k'.repeat(81)}`]: 5 })).toEqual({ channelList: 200 })
    expect(sanitizePanelSizes(null)).toEqual({})
    expect(sanitizePanelSizes([1, 2])).toEqual({})
    expect(sanitizePanelSizes('x')).toEqual({})
  })

  it('caps the number of keys', () => {
    const many = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, 1]))
    expect(Object.keys(sanitizePanelSizes(many))).toHaveLength(300)
  })

  it('patches set, remove (null = default), and ignore invalid values', () => {
    const next = applySizePatch({ a: 1, b: 2 }, { a: null, b: 5, c: NaN, d: -3, e: 7 })
    expect(next).toEqual({ b: 5, e: 7 })
  })

  it('clamp tolerates inverted bounds', () => {
    expect(clamp(5, 10, 3)).toBe(10)
    expect(clamp(5, 0, 3)).toBe(3)
  })
})
