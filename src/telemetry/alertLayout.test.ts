import { describe, expect, it } from 'vitest'
import { DENSITIES, DENSITY_SPEC, pickDensity, requiredHeight } from './alertLayout'

describe('alert card formats', () => {
  it('formats get strictly shorter and narrower down the list', () => {
    for (let i = 1; i < DENSITIES.length; i++) {
      expect(DENSITY_SPEC[DENSITIES[i]].cardH).toBeLessThan(DENSITY_SPEC[DENSITIES[i - 1]].cardH)
      expect(DENSITY_SPEC[DENSITIES[i]].minW).toBeLessThanOrEqual(DENSITY_SPEC[DENSITIES[i - 1]].minW)
    }
  })

  it('needs more height as cards wrap onto more rows, and as the dock narrows', () => {
    expect(requiredHeight('full', 0, 1000)).toBe(0)
    expect(requiredHeight('full', 3, 1000)).toBe(requiredHeight('full', 1, 1000)) // three fit side by side
    expect(requiredHeight('full', 6, 1000)).toBeGreaterThan(requiredHeight('full', 3, 1000))
    expect(requiredHeight('full', 3, 300)).toBeGreaterThan(requiredHeight('full', 3, 1000))
  })

  it('picks the full format when there is room, and re-formats as the dock shrinks', () => {
    const need = (d: 'full' | 'compact' | 'line' | 'chip') => requiredHeight(d, 2, 800)
    expect(pickDensity(need('full'), 800, 2)).toBe('full')
    expect(pickDensity(need('full') - 1, 800, 2)).toBe('compact')
    expect(pickDensity(need('compact') - 1, 800, 2)).toBe('line')
    expect(pickDensity(need('line') - 1, 800, 2)).toBe('chip')
    expect(pickDensity(5, 800, 2)).toBe('chip') // nothing fits: densest, and it scrolls
    expect(pickDensity(1000, 800, 2)).toBe('full')
  })

  it('every format fits a single warning in the smallest dock (30 px)', () => {
    expect(requiredHeight('chip', 1, 800)).toBeLessThanOrEqual(30)
    expect(requiredHeight('line', 1, 800)).toBeLessThanOrEqual(34)
    expect(pickDensity(30, 800, 1)).toBe('chip')
  })

  it('more warnings push toward denser formats at the same height', () => {
    const h = 110
    expect(pickDensity(h, 800, 1)).toBe('full')
    expect(DENSITIES.indexOf(pickDensity(h, 800, 20))).toBeGreaterThan(DENSITIES.indexOf(pickDensity(h, 800, 1)))
  })
})
