import type { AlertRule, ChartConfig, MathChannel } from '../state/ConfigContext'
import { evalExpr, isValidExpr } from './expression'
import { CHANNEL_MAP, frameScope, type Frame } from './simulation'

export interface ActiveAlert {
  id: string
  severity: 'warn' | 'danger'
  message: string
  channels: string[]
}

export function evaluateAlerts(frame: Frame | undefined, rules: AlertRule[], charts: Record<string, ChartConfig>, math: MathChannel[]): ActiveAlert[] {
  if (!frame) return []
  const scope = frameScope(frame)
  const channelsFor = (expr: string) => [...new Set(expr.match(/[A-Za-z_]\w*/g) ?? [])].filter(id => id in CHANNEL_MAP)
  const active: ActiveAlert[] = rules
    .filter(rule => rule.enabled && isValidExpr(rule.expr) && evalExpr(rule.expr, scope) >= 1)
    .map(rule => ({ id: rule.id, severity: rule.severity, message: rule.message, channels: channelsFor(rule.expr) }))

  // A channel can appear in multiple charts; identical limits should produce just one notification.
  const seen = new Set<string>()
  for (const chart of Object.values(charts)) for (const trace of chart.traces) {
    const custom = trace.channel.startsWith('math:') ? math.find(m => `math:${m.id}` === trace.channel) : undefined
    const value = custom ? evalExpr(custom.expr, scope) : scope[trace.channel]
    if (!Number.isFinite(value)) continue
    const severity = trace.dangerAt != null && value >= trace.dangerAt ? 'danger'
      : trace.warnAt != null && value >= trace.warnAt ? 'warn' : null
    if (!severity) continue
    const limit = severity === 'danger' ? trace.dangerAt : trace.warnAt
    const id = `limit:${trace.channel}:${severity}:${limit}`
    if (seen.has(id)) continue
    seen.add(id)
    const unit = custom?.unit ?? CHANNEL_MAP[trace.channel]?.unit
    active.push({ id, severity, message: `${custom?.name ?? CHANNEL_MAP[trace.channel]?.label ?? trace.channel} ≥ ${limit}${unit ? ` ${unit}` : ''}`, channels: [trace.channel] })
  }
  return active
}

export interface AlertEvent extends ActiveAlert {
  startedAt: number
  sessionTime: number
  clearedAt?: number
  dismissed?: boolean
}

export function updateAlertEvents(previous: AlertEvent[], active: ActiveAlert[], now: number, sessionTime: number): AlertEvent[] {
  const ids = new Set(active.map(a => a.id))
  const retained = previous.map(event => ids.has(event.id) || event.clearedAt != null ? event : { ...event, clearedAt: now })
    .filter(event => event.clearedAt == null || now - event.clearedAt < 5000)
  return [
    ...active.map(alert => {
      const existing = retained.find(event => event.id === alert.id && event.clearedAt == null)
      return existing ? { ...existing, ...alert } : { ...alert, startedAt: now, sessionTime }
    }),
    ...retained.filter(event => event.clearedAt != null && !ids.has(event.id)),
  ]
}

export function alertDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

/**
 * Events worth showing, worst first: live before cleared, critical before warning, newest first.
 * Dismissed events are excluded.
 */
export function orderAlertEvents(events: AlertEvent[]): AlertEvent[] {
  return events.filter(event => !event.dismissed).sort((a, b) =>
    Number(a.clearedAt != null) - Number(b.clearedAt != null) ||
    Number(b.severity === 'danger') - Number(a.severity === 'danger') || b.startedAt - a.startedAt)
}

