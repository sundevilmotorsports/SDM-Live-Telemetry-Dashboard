import { Fragment } from 'react'
import { Frame, MONO, LAP_LEN } from '../telemetry/simulation'
import { useConfig, GAUGE_STYLES, type GaugeStyle } from '../state/ConfigContext'
import { convertLevel, convertValue, decimalsFor } from '../telemetry/units'
import { useZeroing } from '../state/ZeroingContext'
import { ResizePair, ResizePx } from './ResizeHandle'
import { WidgetControls, ArcGauge, BarGauge, VBar, FrictionCircle, GpsTrackMap, SuspHistogram, resolveChannelDisplay } from './widgets'

function PanelHeader({ title, right, onConfig }: { title: string; right?: React.ReactNode; onConfig?: () => void }) {
  return (
    <div className="panel-drag flex items-center justify-between px-3 border-b border-[#222] bg-[#111]" style={{ height: 20, cursor: 'grab', touchAction: 'none' }}>
      <span style={{ fontFamily: MONO, fontSize: 8, color: '#858585', letterSpacing: '0.25em' }}>{title}</span>
      <div className="flex items-center gap-2">{right}<WidgetControls onConfig={onConfig} /></div>
    </div>
  )
}


export const EMPTY_FRAME: Frame = {
  t: 0, throttle: 0, brake: 0, steering: 0,
  wFL: 0, wFR: 0, wRL: 0, wRR: 0,
  volt: 0, coolant: 0, oilTemp: 0, oilPress: 0, fuel: 0,
  gX: 0, gY: 0, speed: 0, rpm: 0, gear: 0, lapTime: 0, lapNum: 0,
  suspFL: 0, suspFR: 0, suspRL: 0, suspRR: 0,
}

const STYLE_ICON: Record<GaugeStyle, string> = { dial: '◔', vbar: '▮', hbar: '▬' }
const STYLE_WEIGHT: Record<GaugeStyle, number> = { dial: 2, vbar: 1, hbar: 2 }

export function GaugePanel({ frames }: { frames: Frame[] }) {
  const { gauges, setGauges, math, openConfig, unitPrefs, panelSizes, setPanelSizes } = useConfig()
  const { baselines } = useZeroing()
  const cur = frames[frames.length - 1] ?? EMPTY_FRAME
  const gaugeWeight = (g: { id: string; style: GaugeStyle }) => panelSizes[`g.${g.id}`] ?? STYLE_WEIGHT[g.style]
  const cycleStyle = (id: string) => setGauges(gauges.map(g => {
    if (g.id !== id) return g
    const i = GAUGE_STYLES.findIndex(s => s.id === g.style)
    return { ...g, style: GAUGE_STYLES[(i + 1) % GAUGE_STYLES.length].id }
  }))
  return (
    <div className="flex flex-col h-full bg-[#171717]">
      <PanelHeader title="INSTRUMENT GAUGES" onConfig={() => openConfig({ kind: 'gauges' })} />
      <div className="flex flex-1 items-stretch justify-around px-4 py-1 gap-2">
        {gauges.map((g, i) => {
          // Gauge range/limits are stored in the channel's base unit; show them in the chosen unit.
          const { value, def, conv } = resolveChannelDisplay(g.channel, cur, math, unitPrefs, baselines)
          const common = {
            value, min: convertValue(g.min, conv), max: convertValue(g.max, conv), label: def.label, unit: def.unit, color: def.color,
            warningAt: convertLevel(g.warnAt, conv), dangerAt: convertLevel(g.dangerAt, conv), dp: decimalsFor(def.unit),
          }
          const next = GAUGE_STYLES[(GAUGE_STYLES.findIndex(s => s.id === g.style) + 1) % GAUGE_STYLES.length]
          return (
            <Fragment key={g.id}>
            {i > 0 && (
              <ResizePair axis="x" label={`Resize ${gauges[i - 1].channel} / ${g.channel} gauges`} min={70} line onWeights={setPanelSizes}
                a={{ key: `g.${gauges[i - 1].id}`, weight: gaugeWeight(gauges[i - 1]) }} b={{ key: `g.${g.id}`, weight: gaugeWeight(g) }} />
            )}
            <div className="group relative flex items-stretch" style={{ minWidth: 0, flex: `${gaugeWeight(g)} 1 0` }}>
              {g.style === 'dial'
                ? <ArcGauge {...common} />
                : <BarGauge {...common} orientation={g.style === 'vbar' ? 'vertical' : 'horizontal'} />}
              <button onClick={() => cycleStyle(g.id)} title={`Switch to ${next.title.toLowerCase()}`}
                className="absolute opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ top: 4, right: 2, fontFamily: MONO, fontSize: 10, color: '#4488ff', backgroundColor: '#4488ff14', border: '1px solid #4488ff33', borderRadius: 3, padding: '0 4px', cursor: 'pointer' }}>
                {STYLE_ICON[next.id]}
              </button>
            </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

export function SuspensionPanel({ frames }: { frames: Frame[] }) {
  const { openConfig } = useConfig()
  return (
    <div className="flex flex-col h-full bg-[#171717] border-t border-[#222]">
      <PanelHeader title="SUSPENSION DAMPER VELOCITY" onConfig={() => openConfig({ kind: 'suspension' })}
        right={<span style={{ fontFamily: MONO, fontSize: 7, color: '#808080' }}>mm/s ←REBOUND · BUMP→</span>} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 border-r border-[#222]">
          <div className="flex flex-1 border-b border-[#222]"><SuspHistogram frames={frames} getVal={f => f.suspFL} label="FL DAMPER" color="#00ffff" /></div>
          <div className="flex flex-1"><SuspHistogram frames={frames} getVal={f => f.suspRL} label="RL DAMPER" color="#ffff00" /></div>
        </div>
        <div className="flex flex-col flex-1">
          <div className="flex flex-1 border-b border-[#222]"><SuspHistogram frames={frames} getVal={f => f.suspFR} label="FR DAMPER" color="#00ff41" /></div>
          <div className="flex flex-1"><SuspHistogram frames={frames} getVal={f => f.suspRR} label="RR DAMPER" color="#ff3333" /></div>
        </div>
      </div>
    </div>
  )
}

export function BottomPanel({ frames }: { frames: Frame[] }) {
  const { openConfig, layout, unitPrefs, panelSizes, setPanelSizes } = useConfig()
  const pedalWidth = panelSizes.pedal ?? 120
  const gforceW = panelSizes['bottom.gforce'] ?? 1
  const gpsW = panelSizes['bottom.gps'] ?? 1
  const cur = frames[frames.length - 1] ?? EMPTY_FRAME
  const { baselines } = useZeroing()
  const brake = resolveChannelDisplay('brake', cur, [], unitPrefs, baselines)
  const volt = resolveChannelDisplay('volt', cur, [], unitPrefs, baselines)
  return (
    <div className="flex h-full bg-[#171717] border-t border-[#222]">
      <div className="flex flex-col border-r border-[#222]" style={{ width: pedalWidth, flexShrink: 0 }}>
        <PanelHeader title="PEDAL / ELEC" onConfig={() => openConfig({ kind: 'pedal' })} />
        <div className="flex flex-1 items-end justify-around px-2 pb-3 pt-2">
          <VBar value={cur.throttle} max={100} label="THR" unit="%" color="#00ff41" />
          <VBar value={brake.value} max={brake.def.max} label="BRK" unit={brake.def.unit} color="#ff3333" dp={decimalsFor(brake.def.unit)} />
          <VBar value={volt.value} min={volt.def.min} max={volt.def.max} label="VOLT" unit={volt.def.unit} color="#4488ff" noTopDanger dp={Math.max(1, decimalsFor(volt.def.unit))} />
        </div>
      </div>
      <ResizePx axis="x" label="Resize pedal panel" min={90} max={320} current={() => pedalWidth} onChange={px => setPanelSizes({ pedal: px })} />
      <div className="flex flex-col border-r border-[#222]" style={{ flex: `${gforceW} 1 0`, minWidth: 0 }}>
        <PanelHeader title="G-FORCE SCATTER" onConfig={() => openConfig({ kind: 'gforce' })} />
        <div className="flex-1 flex items-center justify-center p-2"><FrictionCircle frames={frames} /></div>
      </div>
      {layout.gps && (
        <>
        <ResizePair axis="x" label="Resize G-force / GPS" min={80} onWeights={setPanelSizes}
          a={{ key: 'bottom.gforce', weight: gforceW }} b={{ key: 'bottom.gps', weight: gpsW }} />
        <div className="flex flex-col" style={{ flex: `${gpsW} 1 0`, minWidth: 0 }}>
          <PanelHeader title="GPS CIRCUIT MAP" onConfig={() => openConfig({ kind: 'gps' })} />
          <div className="flex-1 p-1"><GpsTrackMap lapFrac={Number.isFinite(cur.lapTime) ? cur.lapTime / LAP_LEN : NaN} /></div>
        </div>
        </>
      )}
    </div>
  )
}
