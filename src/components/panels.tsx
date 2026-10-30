import { Frame, MONO, LAP_LEN } from '../telemetry/simulation'
import { useConfig } from '../state/ConfigContext'
import { WidgetControls, ArcGauge, VBar, FrictionCircle, GpsTrackMap, SuspHistogram, resolveChannel } from './widgets'

function PanelHeader({ title, right, onConfig }: { title: string; right?: React.ReactNode; onConfig?: () => void }) {
  return (
    <div className="panel-drag flex items-center justify-between px-3 border-b border-[#222] bg-[#111]" style={{ height: 20, cursor: 'grab', touchAction: 'none' }}>
      <span style={{ fontFamily: MONO, fontSize: 8, color: '#2a2a2a', letterSpacing: '0.25em' }}>{title}</span>
      <div className="flex items-center gap-2">{right}<WidgetControls onConfig={onConfig} /></div>
    </div>
  )
}

const dpFor = (unit: string) => (unit === 'G' || unit === 'V' || unit === 'bar' ? 1 : 0)

export const EMPTY_FRAME: Frame = {
  t: 0, throttle: 0, brake: 0, steering: 0,
  wFL: 0, wFR: 0, wRL: 0, wRR: 0,
  volt: 0, coolant: 0, oilTemp: 0, oilPress: 0, fuel: 0,
  gX: 0, gY: 0, speed: 0, rpm: 0, gear: 0, lapTime: 0, lapNum: 0,
  suspFL: 0, suspFR: 0, suspRL: 0, suspRR: 0,
}

export function GaugePanel({ frames }: { frames: Frame[] }) {
  const { gauges, math, openConfig } = useConfig()
  const cur = frames[frames.length - 1] ?? EMPTY_FRAME
  return (
    <div className="flex flex-col h-full bg-[#171717]">
      <PanelHeader title="INSTRUMENT GAUGES" onConfig={() => openConfig({ kind: 'gauges' })} />
      <div className="flex flex-1 items-stretch justify-around px-4 py-1 gap-2">
        {gauges.map((g, i) => {
          const { value, def } = resolveChannel(g.channel, cur, math)
          return (
            <div key={g.id} className="flex-1 flex items-stretch" style={{ minWidth: 0 }}>
              {i > 0 && <div className="w-px bg-[#1e1e1e] my-3" />}
              <ArcGauge value={value} min={g.min} max={g.max} label={def.label} unit={def.unit} color={def.color}
                warningAt={g.warnAt} dangerAt={g.dangerAt} dp={dpFor(def.unit)} />
            </div>
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
        right={<span style={{ fontFamily: MONO, fontSize: 7, color: '#1e1e1e' }}>mm/s ←REBOUND · BUMP→</span>} />
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
  const { openConfig, layout } = useConfig()
  const cur = frames[frames.length - 1] ?? EMPTY_FRAME
  return (
    <div className="flex h-full bg-[#171717] border-t border-[#222]">
      <div className="flex flex-col border-r border-[#222]" style={{ width: 120 }}>
        <PanelHeader title="PEDAL / ELEC" onConfig={() => openConfig({ kind: 'pedal' })} />
        <div className="flex flex-1 items-end justify-around px-2 pb-3 pt-2">
          <VBar value={cur.throttle} max={100} label="THR" unit="%" color="#00ff41" />
          <VBar value={cur.brake} max={200} label="BRK" unit="kPa" color="#ff3333" />
          <VBar value={cur.volt} min={10} max={16} label="VOLT" unit="V" color="#4488ff" noTopDanger />
        </div>
      </div>
      <div className="flex flex-col border-r border-[#222]" style={{ flex: 1 }}>
        <PanelHeader title="G-FORCE SCATTER" onConfig={() => openConfig({ kind: 'gforce' })} />
        <div className="flex-1 flex items-center justify-center p-2"><FrictionCircle frames={frames} /></div>
      </div>
      {layout.gps && (
        <div className="flex flex-col" style={{ flex: 1 }}>
          <PanelHeader title="GPS CIRCUIT MAP" onConfig={() => openConfig({ kind: 'gps' })} />
          <div className="flex-1 p-1"><GpsTrackMap lapFrac={Number.isFinite(cur.lapTime) ? cur.lapTime / LAP_LEN : NaN} /></div>
        </div>
      )}
    </div>
  )
}
