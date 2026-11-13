import { useMemo, useRef, useState } from 'react'
import { evaluateAlerts } from './telemetry/alerts'
import TelemetryAlerts, { AlertDock } from './components/TelemetryAlerts'
import { useTelemetry } from './telemetry/useTelemetry'

import { ConfigProvider, useConfig } from './state/ConfigContext'
import { TelemetryStatusProvider } from './state/TelemetryStatusContext'
import { ZeroingProvider } from './state/ZeroingContext'
import { StatusBar } from './components/widgets'
import { TimeSeriesPanel } from './components/TimeSeriesPanel'
import { GaugePanel, SuspensionPanel, BottomPanel } from './components/panels'
import SteeringPanel from './components/SteeringPanel'
import FuelTank from './components/FuelTank'
import type { ChartInspection } from './telemetry/chartView'
import { NavBar, NavId } from './components/NavBar'
import { SessionTimingPanel } from './components/SessionTimingPanel'
import { WidgetConfigModal } from './components/WidgetConfigModal'
import { DraggableStack, StackItem } from './components/DraggableStack'
import { DriverDash } from './views/DriverDash'
import { LapAnalysis } from './views/LapAnalysis'
import { ChannelTable } from './views/ChannelTable'
import { ProfileTabs } from './components/ProfileTabs'
import { ResizeHandle, ResizePair, ResizePx } from './components/ResizeHandle'
import { Frame, MONO } from './telemetry/simulation'
import { publicHost } from './telemetry/live/broadcastClient'
import type { Telemetry } from './telemetry/useTelemetry'

const TOTAL_LAPS = 25


function SourceBanner({ color, title, detail }: { color: string; title: string; detail: string }) {
  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-md"
      style={{
        backgroundColor: '#0d0d0d',
        border: '1px solid #282828',
        boxShadow: '0 12px 40px #000000ee, 0 0 20px #00000088',
        maxWidth: 'min(560px, 92%)',
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, boxShadow: `0 0 8px ${color}`, flexShrink: 0 }} />
      <div className="flex flex-col text-left">
        <span style={{ fontFamily: MONO, fontSize: 8.5, color: '#e0e0e0', fontWeight: 700, letterSpacing: '0.12em' }}>{title}</span>
        <span style={{ fontFamily: MONO, fontSize: 7.5, color: '#9f9f9f', marginTop: 1 }}>{detail}</span>
      </div>
    </div>
  )
}

function supabaseBannerTitle(status: Telemetry['connectionStatus'], freshness: Telemetry['freshness']): string {
  if (status === 'misconfigured') return 'SUPABASE BROADCAST NOT CONFIGURED'
  if (status === 'error') return 'REALTIME ERROR · SUBSCRIPTION REJECTED'
  if (status === 'reconnecting' || status === 'disconnected') return 'REALTIME RECONNECTING'
  if (status !== 'subscribed') return 'CONNECTING TO SUPABASE REALTIME'
  if (freshness === 'stale') return 'SUBSCRIBED · TELEMETRY IS STALE'
  return 'SUBSCRIBED · NO LIVE SAMPLES YET'
}

function supabaseBannerDetail(telemetry: Telemetry, supabaseUrl: string): string {
  if (telemetry.connectionStatus === 'misconfigured') {
    return telemetry.diagnostics?.lastError ?? 'Set the project URL, publishable key, and session UUID.'
  }
  if (telemetry.connectionStatus === 'error' || telemetry.connectionStatus === 'reconnecting') {
    return telemetry.diagnostics?.lastError ?? 'Check the publishable key and Realtime access. Broadcast is not replayed.'
  }
  if (telemetry.connectionStatus !== 'subscribed') return `Joining telemetry:live on ${publicHost(supabaseUrl)}. Broadcast does not replay history.`
  if (telemetry.freshness === 'stale') return 'No newer sample accepted within the stale window. Duplicate broadcasts do not refresh this.'
  return 'Joined. Broadcast does not replay history — waiting for the next group update.'
}
const WEIGHTS: Record<string, number> = { gauges: 30, steering: 20, suspension: 20, bottom: 30 }
const WIDGET_TITLE: Record<string, string> = { gauges: 'INSTRUMENT GAUGES', steering: 'STEERING · FUEL', suspension: 'SUSPENSION DAMPER', bottom: 'PEDAL · G-FORCE · GPS' }

function RightColumn({ frames, inspection }: { frames: Frame[]; inspection: ChartInspection | null }) {
  const { widgetOrder, setWidgetOrder, layout, panelSizes, setPanelSizes } = useConfig()

  const visible = widgetOrder.filter(id => id === 'steering' ? layout.steering || layout.fuel : id === 'suspension' ? layout.suspension : true)
  const hidden = widgetOrder.filter(id => !visible.includes(id))

  const render = (id: string) => {
    if (id === 'gauges') return <GaugePanel frames={frames} />
    if (id === 'steering') {
      const steerW = panelSizes['steer.steering'] ?? 1
      const fuelW = panelSizes['steer.fuel'] ?? 1
      return <div className="flex h-full min-h-0">
        {layout.steering && <div className="min-w-0" style={{ flex: `${steerW} 1 0` }}><SteeringPanel frames={frames} /></div>}
        {layout.steering && layout.fuel && (
          <ResizePair axis="x" label="Resize steering / fuel" min={80} line onWeights={setPanelSizes}
            a={{ key: 'steer.steering', weight: steerW }} b={{ key: 'steer.fuel', weight: fuelW }} />
        )}
        {layout.fuel && <div className="min-w-0" style={{ flex: `${fuelW} 1 0` }}><FuelTank inspection={inspection} /></div>}
      </div>
    }
    if (id === 'suspension') return <SuspensionPanel frames={frames} />
    return <BottomPanel frames={frames} />
  }

  const items: StackItem[] = visible.map(id => ({ id, title: WIDGET_TITLE[id], weight: panelSizes[`w.${id}`] ?? WEIGHTS[id], node: render(id) }))

  return <DraggableStack items={items} onReorder={next => setWidgetOrder([...next, ...hidden])} minPx={60}
    onWeights={patch => setPanelSizes(Object.fromEntries(Object.entries(patch).map(([id, w]) => [`w.${id}`, w])))} />
}

/** Divider that moves a fractional split (0..1 of the container's width). */
function ResizePxFraction({ containerRef, value, onChange }: { containerRef: React.RefObject<HTMLDivElement | null>; value: number; onChange: (fraction: number | null) => void }) {
  const base = useRef({ width: 1, start: value })
  return (
    <ResizeHandle axis="x" label="Resize charts / right column"
      onStart={() => { base.current = { width: containerRef.current?.getBoundingClientRect().width || 1, start: value } }}
      onDelta={d => {
        const { width, start } = base.current
        // Neither side narrower than 260 px (or a quarter of the window when that is smaller).
        const min = Math.min(0.5, 260 / width)
        onChange(Math.min(1 - min, Math.max(min, start + d / width)))
      }}
      onReset={() => onChange(null)} />
  )
}

function Workspace({ frames, telemetry, cur }: { frames: Frame[]; telemetry: Telemetry; cur: Frame | undefined }) {
  const { layout, supabaseUrl, supabaseMode, panelSizes, setPanelSizes } = useConfig()
  const [timingOpen, setTimingOpen] = useState(true)
  const mainRef = useRef<HTMLDivElement>(null)
  const split = Math.min(0.8, Math.max(0.2, panelSizes['split.main'] ?? 0.5))
  const timingWidth = panelSizes.timing ?? 218
  const [inspection, setInspection] = useState<ChartInspection | null>(null)
  const showTiming = layout.timing && timingOpen
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
    <ProfileTabs />
    <div className="relative flex flex-1 overflow-hidden">
      <div ref={mainRef} className="flex flex-1 overflow-hidden" style={{ minWidth: 0 }}>
        <div className="flex flex-col border-r border-[#242424]" style={{ flex: `0 0 ${split * 100}%`, minWidth: 0 }}>
          <TimeSeriesPanel telemetry={telemetry} syncCrosshair={layout.syncCrosshair} onInspectionChange={setInspection} />
        </div>
        <ResizePxFraction containerRef={mainRef} value={split} onChange={f => setPanelSizes({ 'split.main': f })} />
        <div className="flex flex-col" style={{ flex: '1 1 0', minWidth: 0 }}>
          <RightColumn frames={frames} inspection={inspection} />
        </div>
      </div>
      {showTiming && (
        <>
          <ResizePx axis="x" label="Resize session timing" direction={-1} min={160} max={520} current={() => timingWidth}
            onChange={px => setPanelSizes({ timing: px })} />
          <SessionTimingPanel cur={cur} laps={telemetry.laps} bestLap={telemetry.bestLap}
            bestSectors={telemetry.bestSectors} theoretical={telemetry.theoretical} totalLaps={TOTAL_LAPS} width={timingWidth} />
        </>
      )}
      {layout.timing && (
        <button onClick={() => setTimingOpen(p => !p)}
          className="flex flex-col items-center justify-center border-l border-[#1e1e1e] bg-[#111] transition-colors"
          style={{ width: 14, flexShrink: 0, cursor: 'pointer', color: '#898989' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#1a1a1a' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#111' }}
          title={timingOpen ? 'Collapse timing' : 'Expand timing'}>
          <span style={{ fontFamily: MONO, fontSize: 7, writingMode: 'vertical-lr', letterSpacing: '0.2em', color: '#878787' }}>
            {timingOpen ? '›' : '‹'} TIMING
          </span>
        </button>
      )}

      {telemetry.source === 'websocket' && frames.length === 0 && (
        <SourceBanner
          color={telemetry.connectionStatus === 'connected' ? '#00ff41' : '#ffaa00'}
          title={telemetry.connectionStatus === 'connected'
            ? 'CONNECTED TO WEBSOCKET · AWAITING TELEMETRY FRAMES'
            : 'WS DISCONNECTED · WAITING FOR SERVER'}
          detail={telemetry.connectionStatus === 'connected'
            ? 'Socket open. Start your vehicle transmitter or replay.'
            : 'Run: python3 telemetry_server/server.py --port 8765 in a terminal.'}
        />
      )}
      {telemetry.source === 'supabase' && telemetry.freshness !== 'fresh' && (
        <SourceBanner
          color={telemetry.connectionStatus === 'subscribed' ? '#ffaa00' : telemetry.connectionStatus === 'error' || telemetry.connectionStatus === 'misconfigured' ? '#ff3333' : '#ffaa00'}
          title={supabaseMode === 'raw'
            ? telemetry.connectionStatus === 'misconfigured' ? 'RAW TELEMETRY NOT CONFIGURED'
              : telemetry.connectionStatus === 'error' ? 'RAW BATCH READ ERROR'
              : telemetry.connectionStatus !== 'connected' ? 'CONNECTING TO RAW TELEMETRY'
              : telemetry.freshness === 'stale' ? 'RAW TELEMETRY · HISTORICAL OR STALE'
              : 'RAW TELEMETRY · NO CONFIGURED SAMPLES'
            : supabaseBannerTitle(telemetry.connectionStatus, telemetry.freshness)}
          detail={supabaseMode === 'raw'
            ? telemetry.diagnostics?.lastError ?? (telemetry.freshness === 'stale'
              ? 'Showing stored samples, not a fresh vehicle feed. No synthetic values or laps are generated.'
              : 'Reading telemetry.can_batches for the linked session. Sign in, start or pick a session, and check that the car is posting; unknown CAN IDs do not populate gauges.')
            : supabaseBannerDetail(telemetry, supabaseUrl)}
        />
      )}
    </div>
    </div>
  )
}

function Dashboard() {
  const telemetry = useTelemetry()
  const { frames } = telemetry
  const cur = frames[frames.length - 1]
  const cfg = useConfig()
  const [activeNav, setActiveNav] = useState<NavId>('workspace')

  const activeAlerts = useMemo(() => evaluateAlerts(cur, cfg.alerts, cfg.chartCfg, cfg.math), [cur, cfg.alerts, cfg.chartCfg, cfg.math])

  return (
    <div className="relative flex flex-col h-full bg-[#1e1e1e] overflow-hidden select-none">
      <StatusBar
        cur={cur}

        connectionStatus={telemetry.connectionStatus}
        packetRate={telemetry.packetRate}
        source={telemetry.source}
        supabaseMode={cfg.supabaseMode}
        freshness={telemetry.freshness}
        displayedSampleMs={telemetry.displayedSampleMs}

        onOpenConfig={() => cfg.openConfig({ kind: 'source' })}
      />
      <TelemetryAlerts key={`${telemetry.source}:${cfg.supabaseMode}:${cfg.telemetrySessionId}`} alerts={activeAlerts} sessionTime={cur?.t ?? NaN}>
      <TelemetryStatusProvider value={telemetry}>
      <ZeroingProvider telemetry={telemetry}>
      <NavBar active={activeNav} onSelect={setActiveNav} settingsOpen={cfg.configTarget?.kind === 'all'} onSettings={() => cfg.configTarget?.kind === 'all' ? cfg.closeConfig() : cfg.openConfig({ kind: 'all' })} />
      <div className="flex flex-1 overflow-hidden" style={{ position: 'relative' }}>
        {activeNav === 'workspace' && <Workspace frames={frames} telemetry={telemetry} cur={cur} />}
        {activeNav === 'dash' && <div className="flex-1 overflow-hidden"><DriverDash frames={frames} bestLap={telemetry.bestLap} /></div>}
        {activeNav === 'lap' && (
          <div className="flex-1 overflow-hidden">
            <LapAnalysis laps={telemetry.laps} bestLap={telemetry.bestLap} bestSectors={telemetry.bestSectors} theoretical={telemetry.theoretical} totalLaps={TOTAL_LAPS} />
          </div>
        )}
        {activeNav === 'channels' && <ChannelTable telemetry={telemetry} />}
        {cfg.configTarget && <WidgetConfigModal />}
      </div>
      <AlertDock />
      </ZeroingProvider>
      </TelemetryStatusProvider>
      </TelemetryAlerts>
    </div>
  )
}

export default function App() {
  return (
    <ConfigProvider>
      <Dashboard />
    </ConfigProvider>
  )
}
