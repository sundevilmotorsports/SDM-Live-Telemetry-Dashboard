import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { alertDuration, updateAlertEvents, type ActiveAlert, type AlertEvent } from '../telemetry/alerts'
import { MONO } from '../telemetry/simulation'

const AlertContext = createContext<ActiveAlert[]>([])
const colorFor = (severity: ActiveAlert['severity']) => severity === 'danger' ? '#ff4d4d' : '#ffb340'

export function LegendWarnings({ channel }: { channel: string }) {
  const alerts = useContext(AlertContext).filter(alert => alert.channels.includes(channel))
  if (!alerts.length) return null
  return <span className="inline-flex flex-wrap gap-1" aria-label="Active channel warnings">
    {alerts.map(alert => <span key={alert.id} title={`LIVE · ${alert.message}`} style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, color: colorFor(alert.severity), background: `${colorFor(alert.severity)}18`, border: `1px solid ${colorFor(alert.severity)}66`, borderRadius: 2, padding: '1px 4px' }}>
      ⚠ {alert.message}
    </span>)}
  </span>
}

export default function TelemetryAlerts({ alerts, sessionTime, children }: { alerts: ActiveAlert[]; sessionTime: number; children: ReactNode }) {
  const [now, setNow] = useState(Date.now)
  const [events, setEvents] = useState<AlertEvent[]>([])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    setEvents(previous => updateAlertEvents(previous, alerts, now, sessionTime))
  }, [alerts, now, sessionTime])

  const visible = events.filter(event => !event.dismissed).sort((a, b) =>
    Number(a.clearedAt != null) - Number(b.clearedAt != null) ||
    Number(b.severity === 'danger') - Number(a.severity === 'danger') || b.startedAt - a.startedAt)

  return <AlertContext.Provider value={alerts}>
    {children}
    {visible.length > 0 && <aside aria-label="Telemetry warnings" className="absolute bottom-3 right-3 z-40 flex flex-col gap-1.5 overflow-y-auto" style={{ width: 'min(350px, calc(100% - 24px))', maxHeight: '45%', fontFamily: MONO }}>
      <div className="flex items-center justify-between px-1" style={{ fontSize: 8, color: '#aaa', letterSpacing: '0.15em' }}>
        <span>WARNINGS · {alerts.length} ACTIVE</span><span>ELAPSED / MIN:SEC</span>
      </div>
      {visible.map(event => {
        const cleared = event.clearedAt != null
        const color = cleared ? '#80b999' : colorFor(event.severity)
        return <div key={`${event.id}:${event.startedAt}`} className="shrink-0" style={{ background: '#151515', border: `1px solid ${color}66`, borderLeft: `4px solid ${color}`, boxShadow: '0 4px 16px #0008', borderRadius: 3, padding: '9px 10px' }}>
          <div className="flex items-center justify-between gap-3" style={{ fontSize: 8, color, letterSpacing: '0.12em', fontWeight: 700 }}>
            <span>{cleared ? '✓ CLEARED' : event.severity === 'danger' ? '⚠ CRITICAL' : '⚠ WARNING'}</span>
            <button aria-label={`Dismiss ${event.message}`} title="Dismiss notification; the legend warning stays active" onClick={() => setEvents(previous => previous.map(item => item.id === event.id ? { ...item, dismissed: true } : item))} style={{ background: 'none', border: 0, color: '#aaa', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
          <div role="status" className="mt-1" style={{ fontSize: 11, color: cleared ? '#a7b4ac' : '#eee', fontWeight: 700 }}>{event.message}</div>
          <div className="mt-2 flex justify-between gap-3" style={{ fontSize: 9, color: '#999', fontVariantNumeric: 'tabular-nums' }}>
            <span>AT {Number.isFinite(event.sessionTime) ? alertDuration(event.sessionTime * 1000) : '—'}</span>
            <span style={{ color }}>ELAPSED {alertDuration((event.clearedAt ?? now) - event.startedAt)}</span>
          </div>
        </div>
      })}
    </aside>}
  </AlertContext.Provider>
}
