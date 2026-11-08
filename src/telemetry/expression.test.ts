import { describe, expect, it } from 'vitest'
import { evalExpr, exprIdentifiers, isValidExpr } from './expression'

describe('expression', () => {
  it('quoted names reach channels that are not identifiers', () => {
    expect(evalExpr("'%_TPS' * 2", { '%_TPS': 7 })).toBe(14)
    expect(evalExpr("'n-Gear' + t_MAT", { 'n-Gear': 3, t_MAT: 40 })).toBe(43)
    expect(exprIdentifiers("'%_TPS' > 5 && rpm < 500")).toEqual(['%_TPS', 'rpm'])
  })

  it('two-argument functions use the comma', () => {
    expect(evalExpr('max(2, 5)', {})).toBe(5)
    expect(evalExpr('min(rpm, 100) + 1', { rpm: 40 })).toBe(41)
    expect(evalExpr('abs(-3)', {})).toBe(3)
  })

  it('unknown names are NaN and invalid input is rejected', () => {
    expect(evalExpr('nope + 1', {})).toBeNaN()
    expect(isValidExpr('(1 +')).toBe(false)
    expect(isValidExpr('')).toBe(false)
  })
})
