import { describe, expect, it } from 'vitest'
import { alertDuration, evaluateAlerts, updateAlertEvents, type ActiveAlert } from './alerts'
import type { ChartConfig } from '../state/ConfigContext'
import { makeFrame } from './simulation'

const warning: ActiveAlert = { id: 'coolant', severity: 'danger', message: 'HOT', channels: ['coolant'] }

describe('telemetry warnings', () => {
  it('associates compound rules with their exact channel identifiers', () => {
    const frame = { ...makeFrame(0), coolant: 105, oilTemp: 110 }
    expect(evaluateAlerts(frame, [{ id: 'hot', expr: 'coolant > 99 && oilTemp > 100', severity: 'danger', message: 'HOT', enabled: true }], {}, [])[0].channels).toEqual(['coolant', 'oilTemp'])
  })

  it('ignores disabled rules and unavailable samples', () => {
    const rules = [{ id: 'hot', expr: 'coolant > 99', severity: 'danger' as const, message: 'HOT', enabled: false }]
    expect(evaluateAlerts({ ...makeFrame(0), coolant: 105 }, rules, {}, [])).toEqual([])
    expect(evaluateAlerts(undefined, rules, {}, [])).toEqual([])
    expect(evaluateAlerts({ ...makeFrame(0), coolant: NaN }, [{ ...rules[0], enabled: true }], {}, [])).toEqual([])
  })

  it('deduplicates chart limits and prioritizes danger over warning', () => {
    const chart = { title: 'RPM', traces: [{ channel: 'rpm', min: 0, max: 8000, color: '#fff', warnAt: 6800, dangerAt: 7400 }] } as ChartConfig
    const alerts = evaluateAlerts({ ...makeFrame(0), rpm: 7600 }, [], { first: chart, second: chart }, [])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ severity: 'danger', channels: ['rpm'] })
  })

  it('supports math trace limits', () => {
    const chart = { title: 'Double RPM', traces: [{ channel: 'math:double', warnAt: 10000 }] } as ChartConfig
    const alerts = evaluateAlerts({ ...makeFrame(0), rpm: 6000 }, [], { math: chart }, [{ id: 'double', name: 'Double RPM', expr: 'rpm * 2', unit: 'rpm' }])
    expect(alerts[0]).toMatchObject({ severity: 'warn', channels: ['math:double'], message: 'Double RPM ≥ 10000 rpm' })
  })

  it('keeps the original trigger time and dismissal during an active event', () => {
    const first = updateAlertEvents([], [warning], 1000, 12)
    const next = updateAlertEvents([{ ...first[0], dismissed: true }], [warning], 4000, 15)
    expect(next[0]).toMatchObject({ startedAt: 1000, sessionTime: 12, dismissed: true })
  })

  it('retains cleared warnings for five seconds, then expires them', () => {
    const first = updateAlertEvents([], [warning], 1000, 12)
    const cleared = updateAlertEvents(first, [], 4000, 15)
    expect(cleared[0].clearedAt).toBe(4000)
    expect(updateAlertEvents(cleared, [], 8999, 20)).toHaveLength(1)
    expect(updateAlertEvents(cleared, [], 9000, 20)).toEqual([])
  })

  it('rearms dismissed warnings when the condition recurs', () => {
    const first = updateAlertEvents([], [warning], 1000, 12)
    const cleared = updateAlertEvents([{ ...first[0], dismissed: true }], [], 2000, 13)
    const retriggered = updateAlertEvents(cleared, [warning], 3000, 14)
    expect(retriggered).toHaveLength(1)
    expect(retriggered[0]).toMatchObject({ startedAt: 3000, sessionTime: 14 })
    expect(retriggered[0].dismissed).toBeUndefined()
  })

  it('formats elapsed minutes and seconds', () => {
    expect(alertDuration(65999)).toBe('01:05')
    expect(alertDuration(-1)).toBe('00:00')
  })
})

describe('warning dock ordering', () => {
  const ev = (id: string, severity: 'warn' | 'danger', startedAt: number, extra: Partial<import('./alerts').AlertEvent> = {}): import('./alerts').AlertEvent =>
    ({ id, severity, message: id, channels: [], startedAt, sessionTime: 0, ...extra })

  it('orders live before cleared, critical before warning, newest first, and drops dismissed', async () => {
    const { orderAlertEvents } = await import('./alerts')
    const ordered = orderAlertEvents([
      ev('old-warn', 'warn', 1), ev('new-warn', 'warn', 5), ev('crit', 'danger', 3),
      ev('cleared-crit', 'danger', 9, { clearedAt: 10 }), ev('hidden', 'danger', 8, { dismissed: true }),
    ])
    expect(ordered.map(e => e.id)).toEqual(['crit', 'new-warn', 'old-warn', 'cleared-crit'])
  })
})
