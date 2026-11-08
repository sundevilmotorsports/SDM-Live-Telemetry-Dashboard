import { describe, expect, it } from 'vitest'
import { convertLevel, convertValue, decimalsFor, rawChannelUnit, resolveUnit, sanitizeUnitPrefs, unitOptions } from './units'

describe('unit conversion', () => {
  it('offers alternatives only for units that have a family', () => {
    expect(unitOptions('km/h').map(o => o.label)).toEqual(['km/h', 'm/s', 'mph'])
    expect(unitOptions('°C').map(o => o.label)).toEqual(['°C', '°F', 'K'])
    expect(unitOptions('%')).toEqual([])
    expect(unitOptions('')).toEqual([])
  })

  it('converts speed, temperature (with offset), and pressure', () => {
    expect(convertValue(36, resolveUnit('km/h', 'm/s'))).toBeCloseTo(10, 9)
    expect(convertValue(100, resolveUnit('km/h', 'mph'))).toBeCloseTo(62.1371, 4)
    expect(convertValue(100, resolveUnit('°C', '°F'))).toBeCloseTo(212, 9)
    expect(convertValue(0, resolveUnit('°C', 'K'))).toBeCloseTo(273.15, 9)
    expect(convertValue(100, resolveUnit('kPa', 'bar'))).toBeCloseTo(1, 9)
    expect(convertValue(1, resolveUnit('G', 'm/s²'))).toBeCloseTo(9.80665, 9)
  })

  it('every alternative is increasing, so converted ranges and limits keep their order', () => {
    for (const base of ['km/h', '°C', 'kPa', 'bar', 'G', 'mm/s', 'rpm', 'V', '°']) {
      for (const o of unitOptions(base)) expect(o.scale).toBeGreaterThan(0)
    }
  })

  it('falls back to the base unit for an unknown or stale preference', () => {
    expect(resolveUnit('km/h', 'furlongs').label).toBe('km/h')
    expect(resolveUnit('km/h', undefined).label).toBe('km/h')
    expect(resolveUnit('%', 'mph')).toMatchObject({ label: '%', scale: 1, offset: 0 })
    expect(resolveUnit('°C', 'kPa').label).toBe('°C') // a unit from a different family is not valid here
  })

  it('never turns an unavailable value into a number', () => {
    const f = resolveUnit('°C', '°F')
    expect(convertValue(NaN, f)).toBeNaN()
    expect(convertValue(Infinity, f)).toBe(Infinity)
    expect(convertLevel(null, f)).toBeNull()
    expect(convertLevel(undefined, f)).toBeNull()
    expect(convertLevel(0, f)).toBe(32)
  })

  it('shows one decimal for small-magnitude units', () => {
    expect(decimalsFor('m/s')).toBe(1)
    expect(decimalsFor('bar')).toBe(1)
    expect(decimalsFor('km/h')).toBe(0)
  })

  it('sanitizes stored preferences', () => {
    expect(sanitizeUnitPrefs({ speed: 'mph', bad: 3, worse: null })).toEqual({ speed: 'mph' })
    expect(sanitizeUnitPrefs(null)).toEqual({})
    expect(sanitizeUnitPrefs(['mph'])).toEqual({})
    expect(sanitizeUnitPrefs('mph')).toEqual({})
  })

  it('infers raw logger units only where the name states one', () => {
    expect(rawChannelUnit('t_eng_coolant')).toBe('°C')
    expect(rawChannelUnit('temp_c_2')).toBe('°C')
    expect(rawChannelUnit('%_TPS')).toBe('%')
    expect(rawChannelUnit('r_engine')).toBe('rpm')
    expect(rawChannelUnit('rate_lpm_1')).toBe('L/min')
    expect(rawChannelUnit('total_volume_l_1')).toBe('L')
    expect(rawChannelUnit('n-Gear')).toBe('')
    expect(rawChannelUnit('a_Lat')).toBe('') // unit not stated by the name: do not guess
    expect(rawChannelUnit('p_oil')).toBe('')
  })
})
