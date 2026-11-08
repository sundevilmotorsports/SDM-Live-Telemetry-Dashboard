import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { CARD_GAP, DENSITY_SPEC, HEADER_H, pickDensity, type AlertDensity } from '../telemetry/alertLayout'
import { alertDuration, orderAlertEvents, updateAlertEvents, type ActiveAlert, type AlertEvent } from '../telemetry/alerts'
import { MONO } from '../telemetry/simulation'
import { useConfig } from '../state/ConfigContext'
import { ResizePx } from './ResizeHandle'

const AlertContext = createContext<ActiveAlert[]>([])
interface AlertEvents { events: AlertEvent[]; now: number; dismiss: (id: string) => void }
const AlertEventsContext = createContext<AlertEvents>({ events: [], now: 0, dismiss: () => {} })
const colorFor = (severity: ActiveAlert['severity']) => severity === 'danger' ? '#ff4d4d' : '#ffb340'
const CLEARED = '#80b999'

export function LegendWarnings({ channel }: { channel: string }) {
  const alerts = useContext(AlertContext).filter(alert => alert.channels.includes(channel))
  if (!alerts.length) return null
  return <span className="inline-flex flex-wrap gap-1" aria-label="Active channel warnings">
    {alerts.map(alert => <span key={alert.id} title={`LIVE · ${alert.message}`} style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, color: colorFor(alert.severity), background: `${colorFor(alert.severity)}18`, border: `1px solid ${colorFor(alert.severity)}66`, borderRadius: 2, padding: '1px 4px' }}>
      ⚠ {alert.message}
    </span>)}
  </span>
}

/** Tracks warning events (start, clear, dismiss). Render <AlertDock /> at the bottom of the layout. */
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
  const dismiss = (id: string) => setEvents(previous => previous.map(item => item.id === id ? { ...item, dismissed: true } : item))

  return <AlertContext.Provider value={alerts}>
    <AlertEventsContext.Provider value={{ events, now, dismiss }}>{children}</AlertEventsContext.Provider>
  </AlertContext.Provider>
}

function kindLabel(event: AlertEvent): string {
  return event.clearedAt != null ? '✓ CLEARED' : event.severity === 'danger' ? '⚠ CRITICAL' : '⚠ WARNING'
}

function ElapsedText({ event, now }: { event: AlertEvent; now: number }) {
  return <>{alertDuration((event.clearedAt ?? now) - event.startedAt)}</>
}

const closeBtn = (size: number): React.CSSProperties => ({ background: 'none', border: 0, color: '#bdbdbd', cursor: 'pointer', fontSize: size, lineHeight: 1, padding: '0 2px', flexShrink: 0 })

/** One warning in the given format. Text always ellipsizes (never clips mid-row) and the full message is in the tooltip. */
export function AlertCard({ event, density, now, dismiss }: { event: AlertEvent; density: AlertDensity; now: number; dismiss: (id: string) => void }) {
  const cleared = event.clearedAt != null
  const color = cleared ? CLEARED : colorFor(event.severity)
  const critical = !cleared && event.severity === 'danger'
  const spec = DENSITY_SPEC[density]
  const at = Number.isFinite(event.sessionTime) ? alertDuration(event.sessionTime * 1000) : '—'
  const ellipsis: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }
  const dismissButton = (size: number) => (
    <button aria-label={`Dismiss ${event.message}`} title="Dismiss notification; the legend warning stays active" onClick={() => dismiss(event.id)} style={closeBtn(size)}>×</button>
  )
  const shell: React.CSSProperties = {
    flex: `1 1 ${spec.minW}px`, minWidth: 0, maxWidth: 380, height: spec.cardH, boxSizing: 'border-box', background: '#151515',
    border: `1px solid ${color}66`, borderLeft: `4px solid ${color}`, borderRadius: 3, overflow: 'hidden',
  }
  const tip = `${kindLabel(event)} · ${event.message} · at ${at} · elapsed ${alertDuration((event.clearedAt ?? now) - event.startedAt)}`
  const icon = cleared ? '✓' : '⚠'

  if (density === 'full') {
    return (
      <div className={critical ? 'alert-pulse' : undefined} title={tip} style={{ ...shell, padding: '6px 10px' }}>
        <div className="flex items-center justify-between gap-3" style={{ fontSize: 8, color, letterSpacing: '0.12em', fontWeight: 700 }}>
          <span>{kindLabel(event)}</span>{dismissButton(14)}
        </div>
        <div role="status" style={{ ...ellipsis, fontSize: 11, color: cleared ? '#a7b4ac' : '#eee', fontWeight: 700, marginTop: 2 }}>{event.message}</div>
        <div className="flex justify-between gap-3" style={{ fontSize: 9, color: '#b6b6b6', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
          <span>AT {at}</span><span style={{ color }}>ELAPSED <ElapsedText event={event} now={now} /></span>
        </div>
      </div>
    )
  }
  if (density === 'compact') {
    return (
      <div className={critical ? 'alert-pulse' : undefined} title={tip} style={{ ...shell, padding: '3px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <span role="status" style={{ ...ellipsis, flex: 1, fontSize: 10, fontWeight: 700, color: cleared ? '#a7b4ac' : '#eee' }}><span style={{ color }}>{icon}</span> {event.message}</span>
          {dismissButton(13)}
        </div>
        <div className="flex justify-between gap-2" style={{ fontSize: 8, color: '#b6b6b6', fontVariantNumeric: 'tabular-nums' }}>
          <span>AT {at}</span><span style={{ color }}>ELAPSED <ElapsedText event={event} now={now} /></span>
        </div>
      </div>
    )
  }
  const small = density === 'chip'
  return (
    <div className={critical ? 'alert-pulse' : undefined} title={tip} style={{ ...shell, padding: '0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span role="status" style={{ ...ellipsis, flex: 1, fontSize: small ? 9 : 10, fontWeight: 700, color: cleared ? '#a7b4ac' : '#eee' }}><span style={{ color }}>{icon}</span> {event.message}</span>
      {/* Elapsed time is never dropped: the message ellipsizes first. */}
      <span style={{ fontSize: 9, color, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}><ElapsedText event={event} now={now} /></span>
      {dismissButton(small ? 12 : 13)}
    </div>
  )
}

/** Dock content box (excluding the dock's own padding is handled by the format spec). */
function useDockSize(ref: React.RefObject<HTMLElement | null>, enabled: boolean): { width: number; windowHeight: number } {
  const [size, setSize] = useState({ width: 800, windowHeight: typeof window === 'undefined' ? 800 : window.innerHeight })
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const measure = () => setSize(prev => {
      const next = { width: Math.round(el.clientWidth), windowHeight: window.innerHeight }
      return prev.width === next.width && prev.windowHeight === next.windowHeight ? prev : next
    })
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    return () => { window.removeEventListener('resize', measure); observer?.disconnect() }
  }, [ref, enabled])
  return size
}

/**
 * Warning cards docked at the bottom of the dashboard. They are part of the layout, not an
 * overlay: when a warning appears the content above shrinks to make room, so no chart or
 * panel is ever covered. Drag the top edge to resize it; the cards re-format (full, compact,
 * line, chip) so their text stays readable at any height instead of being cut off.
 */
export function AlertDock() {
  const { events, now, dismiss } = useContext(AlertEventsContext)
  const active = useContext(AlertContext)
  const { panelSizes, setPanelSizes } = useConfig()
  const dockRef = useRef<HTMLElement>(null)
  const ordered = orderAlertEvents(events)
  const visible = ordered.length > 0
  const { width, windowHeight } = useDockSize(dockRef, visible)
  if (!visible) return null
  // Default: as tall as the cards need, up to 30% of the window. Dragging the top edge sets a height.
  const custom = panelSizes.alertDock
  const available = custom ?? Math.round(windowHeight * 0.3)
  const density = pickDensity(available, width, ordered.length)
  const spec = DENSITY_SPEC[density]

  return (
    <>
    <ResizePx axis="y" label="Resize warnings" direction={-1} min={30} max={Math.round(windowHeight * 0.7)}
      current={() => dockRef.current?.getBoundingClientRect().height ?? 120} onChange={px => setPanelSizes({ alertDock: px })} line />
    <aside ref={dockRef} aria-label="Telemetry warnings" className="bg-[#0f0f0f]"
      style={{ flexShrink: 0, ...(custom ? { height: custom, maxHeight: '70vh' } : { maxHeight: '30vh' }), overflowY: 'auto', fontFamily: MONO, padding: `${Math.round(spec.padV * 0.43)}px ${spec.padH}px ${Math.round(spec.padV * 0.57)}px`, boxSizing: 'border-box' }}>
      {spec.header && (
        <div className="flex items-center justify-between px-1" style={{ fontSize: 8, color: '#bdbdbd', letterSpacing: '0.15em', height: HEADER_H - 5, marginBottom: 5 }}>
          <span>WARNINGS · {active.length} ACTIVE</span><span>ELAPSED / MIN:SEC</span>
        </div>
      )}
      <div className="flex flex-wrap" style={{ gap: CARD_GAP }}>
        {ordered.map(event => <AlertCard key={`${event.id}:${event.startedAt}`} event={event} density={density} now={now} dismiss={dismiss} />)}
      </div>
    </aside>
    </>
  )
}
