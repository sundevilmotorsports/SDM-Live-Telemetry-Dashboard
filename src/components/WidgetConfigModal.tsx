import { useState } from 'react'
import { MONO, CHANNELS, CHANNEL_MAP, CHART_BASE_MAP } from '../telemetry/simulation'
import { isValidExpr } from '../telemetry/expression'
import { useConfig, GaugeConfig, AlertRule, MathChannel, ConfigTarget, DEFAULT_STALE_MS } from '../state/ConfigContext'
import { useTelemetryStatus } from '../state/TelemetryStatusContext'
import { DASHBOARD_FIELD_MAPPINGS, UNMAPPED_DASHBOARD_FIELDS, channelLabel, gpsPosition } from '../telemetry/live/mapToFrame'
import type { ChannelState } from '../telemetry/live/types'
import { LIVE_CHANNEL_MAP } from '../telemetry/live/channelSet1'
import { publicHost } from '../telemetry/live/broadcastClient'

const selectStyle: React.CSSProperties = { backgroundColor: '#1a1a1a', color: '#999', border: '1px solid #2e2e2e', fontFamily: MONO, fontSize: 9, padding: '4px 6px', borderRadius: 3, width: '100%', outline: 'none' }
const labelStyle: React.CSSProperties = { fontFamily: MONO, fontSize: 8, color: '#3a3a3a', letterSpacing: '0.12em' }
const num = (v: number | null): string => (v == null ? '' : String(v))
const SWATCHES = ['#00ff41', '#ff3333', '#ffff00', '#00ffff', '#4488ff', '#c88bff', '#ff8800', '#33ff99', '#ff6644', '#00ffaa']

function idBtn(color: string): React.CSSProperties {
  return { fontFamily: MONO, fontSize: 8, color, backgroundColor: `${color}12`, border: `1px solid ${color}30`, padding: '3px 7px', borderRadius: 3, cursor: 'pointer', letterSpacing: '0.1em' }
}

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <>
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 8px', borderRadius: 4,
        backgroundColor: open ? '#4488ff14' : '#1a1a1a', color: open ? '#4488ff' : '#666', fontFamily: MONO, fontSize: 9,
        letterSpacing: '0.15em', cursor: 'pointer', border: 'none', borderLeft: open ? '2px solid #4488ff55' : '2px solid transparent',
      }}>
        <span>{title}</span><span style={{ fontSize: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="flex flex-col gap-2 px-2 py-2 rounded" style={{ backgroundColor: '#131313', border: '1px solid #1e1e1e' }}>{children}</div>}
    </>
  )
}

function ThresholdBar({ min, max, warnAt, dangerAt, color }: { min: number; max: number; warnAt: number | null; dangerAt: number | null; color: string }) {
  const span = max - min || 1
  const wPct = warnAt != null ? ((warnAt - min) / span) * 100 : 100
  const dPct = dangerAt != null ? ((dangerAt - min) / span) * 100 : 100
  return <div className="rounded overflow-hidden" style={{ height: 8, background: `linear-gradient(to right, ${color}, ${color} ${Math.max(0, wPct - 5)}%, #ff8800 ${wPct}%, #ff8800 ${dPct}%, #ff3333 ${dPct}%)` }} />
}

function TITLE(target: ConfigTarget): string {
  switch (target.kind) {
    case 'chart': return `${(CHART_BASE_MAP[target.id]?.label ?? 'CHANNEL')} CONFIGURATION`
    case 'gauges': return 'INSTRUMENT GAUGES CONFIGURATION'
    case 'suspension': return 'SUSPENSION DAMPER CONFIGURATION'
    case 'pedal': return 'PEDAL / ELEC CONFIGURATION'
    case 'gforce': return 'G-FORCE SCATTER CONFIGURATION'
    case 'gps': return 'GPS CIRCUIT MAP CONFIGURATION'
    case 'source': return 'TELEMETRY SOURCE & NETWORK BRIDGE'
    case 'all': return 'SETTINGS & CUSTOMIZATION'
  }
}

export function WidgetConfigModal() {
  const cfg = useConfig()
  const target = cfg.configTarget!
  const [open, setOpen] = useState({ source: true, gauges: false, alerts: false, math: false, layout: false })
  const t = (k: keyof typeof open) => setOpen(o => ({ ...o, [k]: !o[k] }))

  const channelOpts = [
    ...CHANNELS.map(c => ({ value: c.id, label: `${c.label} (${c.unit || '—'})` })),
    ...cfg.math.map(m => ({ value: `math:${m.id}`, label: `∑ ${m.name}` })),
  ]
  const updateGauge = (id: string, patch: Partial<GaugeConfig>) => cfg.setGauges(cfg.gauges.map(g => (g.id === id ? { ...g, ...patch } : g)))
  const updateAlert = (id: string, patch: Partial<AlertRule>) => cfg.setAlerts(cfg.alerts.map(a => (a.id === id ? { ...a, ...patch } : a)))
  const updateMath = (id: string, patch: Partial<MathChannel>) => cfg.setMath(cfg.math.map(m => (m.id === id ? { ...m, ...patch } : m)))

  // ── Per-target body ─────────────────────────────────────────────────────────
  const chartBody = (id: string) => {
    const base = CHART_BASE_MAP[id]
    if (!base) return null
    const stored = cfg.chartCfg[id]
    const c = {
      channel: stored?.channel ?? base.channel,
      color: stored?.color ?? base.color,
      min: Number.isFinite(stored?.min) ? stored!.min : base.min,
      max: Number.isFinite(stored?.max) ? stored!.max : base.max,
      warnAt: stored?.warnAt ?? null,
      dangerAt: stored?.dangerAt ?? null,
    }
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span style={labelStyle}>CHANNEL ASSIGNMENT</span>
          <select style={selectStyle} value={c.channel} onChange={e => {
            const ch = e.target.value; const def = ch.startsWith('math:') ? null : CHANNEL_MAP[ch]
            cfg.updateChart(id, def ? { channel: ch, min: def.min, max: def.max } : { channel: ch })
          }}>
            {channelOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span style={labelStyle}>TRACE COLOR</span>
          <div className="flex items-center gap-2">
            <input type="color" value={c.color} onChange={e => cfg.updateChart(id, { color: e.target.value })}
              style={{ width: 28, height: 22, padding: 0, border: '1px solid #2e2e2e', borderRadius: 3, background: 'none', cursor: 'pointer' }} />
            <div className="flex flex-wrap gap-1">
              {SWATCHES.map(s => (
                <button key={s} onClick={() => cfg.updateChart(id, { color: s })}
                  style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: s, border: c.color.toLowerCase() === s ? '2px solid #fff' : '1px solid #00000060', cursor: 'pointer' }} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex flex-col gap-1 flex-1"><span style={labelStyle}>SCALE MIN</span>
            <input type="number" value={c.min} onChange={e => cfg.updateChart(id, { min: Number(e.target.value) })} style={selectStyle} /></div>
          <div className="flex flex-col gap-1 flex-1"><span style={labelStyle}>SCALE MAX</span>
            <input type="number" value={c.max} onChange={e => cfg.updateChart(id, { max: Number(e.target.value) })} style={selectStyle} /></div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span style={labelStyle}>COLOR THRESHOLDS</span>
          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1"><span style={{ ...labelStyle, color: '#ff8800' }}>WARN ≥</span>
              <input type="number" value={num(c.warnAt)} placeholder="off" onChange={e => cfg.updateChart(id, { warnAt: e.target.value === '' ? null : Number(e.target.value) })} style={selectStyle} /></div>
            <div className="flex flex-col gap-1 flex-1"><span style={{ ...labelStyle, color: '#ff3333' }}>DANGER ≥</span>
              <input type="number" value={num(c.dangerAt)} placeholder="off" onChange={e => cfg.updateChart(id, { dangerAt: e.target.value === '' ? null : Number(e.target.value) })} style={selectStyle} /></div>
          </div>
          <ThresholdBar min={c.min} max={c.max} warnAt={c.warnAt} dangerAt={c.dangerAt} color={c.color} />
        </div>

        <MathQuickAdd onAdd={mid => cfg.updateChart(id, { channel: `math:${mid}` })} />
      </div>
    )
  }

  const gaugeEditor = (
    <>
      {cfg.gauges.map((g, i) => (
        <div key={g.id} className="flex flex-col gap-1.5 pb-2" style={{ borderBottom: i < cfg.gauges.length - 1 ? '1px solid #1c1c1c' : 'none' }}>
          <div className="flex items-center justify-between">
            <span style={labelStyle}>GAUGE {i + 1} — CHANNEL</span>
            {cfg.gauges.length > 1 && <button onClick={() => cfg.setGauges(cfg.gauges.filter(x => x.id !== g.id))} style={idBtn('#ff6644')}>REMOVE</button>}
          </div>
          <select style={selectStyle} value={g.channel} onChange={e => {
            const ch = e.target.value; const def = ch.startsWith('math:') ? null : CHANNEL_MAP[ch]
            updateGauge(g.id, def ? { channel: ch, min: def.min, max: def.max, warnAt: null, dangerAt: null } : { channel: ch })
          }}>
            {channelOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1"><span style={labelStyle}>MIN</span>
              <input type="number" value={g.min} onChange={e => updateGauge(g.id, { min: Number(e.target.value) })} style={selectStyle} /></div>
            <div className="flex flex-col gap-1 flex-1"><span style={labelStyle}>MAX</span>
              <input type="number" value={g.max} onChange={e => updateGauge(g.id, { max: Number(e.target.value) })} style={selectStyle} /></div>
          </div>
          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1"><span style={{ ...labelStyle, color: '#ff8800' }}>WARN ≥</span>
              <input type="number" value={num(g.warnAt)} placeholder="off" onChange={e => updateGauge(g.id, { warnAt: e.target.value === '' ? null : Number(e.target.value) })} style={selectStyle} /></div>
            <div className="flex flex-col gap-1 flex-1"><span style={{ ...labelStyle, color: '#ff3333' }}>DANGER ≥</span>
              <input type="number" value={num(g.dangerAt)} placeholder="off" onChange={e => updateGauge(g.id, { dangerAt: e.target.value === '' ? null : Number(e.target.value) })} style={selectStyle} /></div>
          </div>
          {(g.warnAt != null || g.dangerAt != null) && <ThresholdBar min={g.min} max={g.max} warnAt={g.warnAt} dangerAt={g.dangerAt} color={g.channel.startsWith('math:') ? '#c88bff' : CHANNEL_MAP[g.channel]?.color ?? '#00ccff'} />}
        </div>
      ))}
      <button onClick={() => cfg.setGauges([...cfg.gauges, { id: `g${Date.now()}`, channel: 'coolant', min: 40, max: 130, warnAt: 105, dangerAt: 115 }])} style={{ ...idBtn('#4488ff'), width: '100%', padding: '6px' }}>+ ADD GAUGE</button>
    </>
  )

  const alertEditor = (
    <>
      {cfg.alerts.map(a => {
        const valid = isValidExpr(a.expr)
        return (
          <div key={a.id} className="flex flex-col gap-1.5 pb-2" style={{ borderBottom: '1px solid #1c1c1c' }}>
            <div className="flex items-center gap-1.5">
              <button onClick={() => updateAlert(a.id, { enabled: !a.enabled })} title="toggle"
                style={{ width: 26, height: 13, borderRadius: 7, backgroundColor: a.enabled ? '#4488ff' : '#2a2a2a', position: 'relative', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 2, left: a.enabled ? 15 : 2, width: 9, height: 9, borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.15s' }} />
              </button>
              <input value={a.expr} onChange={e => updateAlert(a.id, { expr: e.target.value })}
                style={{ ...selectStyle, border: `1px solid ${valid ? '#2e2e2e' : '#ff3333'}`, color: valid ? '#9bd' : '#ff6644' }} placeholder="e.g. coolant > 100" />
              <button onClick={() => cfg.setAlerts(cfg.alerts.filter(x => x.id !== a.id))} style={{ ...idBtn('#ff6644'), flexShrink: 0 }}>✕</button>
            </div>
            <div className="flex gap-1.5">
              <select value={a.severity} onChange={e => updateAlert(a.id, { severity: e.target.value as 'warn' | 'danger' })} style={{ ...selectStyle, width: 90, flexShrink: 0 }}>
                <option value="warn">WARN</option><option value="danger">DANGER</option>
              </select>
              <input value={a.message} onChange={e => updateAlert(a.id, { message: e.target.value })} style={selectStyle} placeholder="alert message" />
            </div>
          </div>
        )
      })}
      <button onClick={() => cfg.setAlerts([...cfg.alerts, { id: `a${Date.now()}`, expr: 'speed > 200', severity: 'warn', message: 'NEW ALERT', enabled: true }])} style={{ ...idBtn('#4488ff'), width: '100%', padding: '6px' }}>+ ADD ALERT RULE</button>
    </>
  )

  const mathEditor = (
    <>
      {cfg.math.map(m => {
        const valid = isValidExpr(m.expr)
        return (
          <div key={m.id} className="flex flex-col gap-1.5 pb-2" style={{ borderBottom: '1px solid #1c1c1c' }}>
            <div className="flex gap-1.5">
              <input value={m.name} onChange={e => updateMath(m.id, { name: e.target.value })} style={selectStyle} placeholder="name" />
              <input value={m.unit} onChange={e => updateMath(m.id, { unit: e.target.value })} style={{ ...selectStyle, width: 60, flexShrink: 0 }} placeholder="unit" />
              <button onClick={() => cfg.setMath(cfg.math.filter(x => x.id !== m.id))} style={{ ...idBtn('#ff6644'), flexShrink: 0 }}>✕</button>
            </div>
            <input value={m.expr} onChange={e => updateMath(m.id, { expr: e.target.value })}
              style={{ ...selectStyle, border: `1px solid ${valid ? '#2e2e2e' : '#ff3333'}`, color: valid ? '#c88bff' : '#ff6644' }} placeholder="(wFL + wFR) / 2" />
            <div className="flex flex-wrap gap-1">
              {['speed', 'rpm', 'throttle', 'brake', 'gX', 'gY', 'volt', 'sqrt(', 'abs('].map(ch => (
                <span key={ch} onClick={() => updateMath(m.id, { expr: m.expr + ch })} style={{ fontFamily: MONO, fontSize: 7.5, color: '#4488ff', backgroundColor: '#4488ff14', padding: '2px 5px', borderRadius: 3, cursor: 'pointer', border: '1px solid #4488ff22' }}>{ch}</span>
              ))}
            </div>
          </div>
        )
      })}
      <button onClick={() => cfg.setMath([...cfg.math, { id: `m${Date.now()}`, name: 'Custom', unit: '', expr: 'speed / rpm' }])} style={{ ...idBtn('#c88bff'), width: '100%', padding: '6px' }}>+ ADD MATH CHANNEL</button>
    </>
  )

  const layoutEditor = (only?: (keyof typeof cfg.layout)[]) => {
    const rows = ([['suspension', 'Show Suspension Panel'], ['timing', 'Show Session Timing'], ['gps', 'Show GPS Track Map'], ['syncCrosshair', 'Sync Crosshair']] as [keyof typeof cfg.layout, string][])
      .filter(([k]) => !only || only.includes(k))
    return rows.map(([key, label]) => (
      <label key={key} className="flex items-center gap-2 cursor-pointer" onClick={() => cfg.setLayout({ ...cfg.layout, [key]: !cfg.layout[key] })}>
        <div style={{ width: 28, height: 14, borderRadius: 7, backgroundColor: cfg.layout[key] ? '#4488ff' : '#2a2a2a', position: 'relative', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 2, left: cfg.layout[key] ? 16 : 2, width: 10, height: 10, borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.15s' }} />
        </div>
        <span style={{ fontFamily: MONO, fontSize: 8, color: '#484848' }}>{label}</span>
      </label>
    ))
  }

  const descriptor = (text: string) => <span style={{ fontFamily: MONO, fontSize: 8, color: '#3a3a3a', lineHeight: 1.6, letterSpacing: '0.05em' }}>{text}</span>

  const sourceEditor = (
    <div className="flex flex-col gap-3">
      {descriptor('Choose where telemetry data originates. Simulation and the local WebSocket bridge stay available. Supabase Broadcast receives decoded live updates directly — this app does not decode HTP or sign posts.')}

      {/* Mode Selector Cards */}
      <div className="grid grid-cols-3 gap-2">
        <div
          onClick={() => cfg.setTelemetrySource('simulation')}
          className="flex flex-col gap-1 p-2.5 rounded cursor-pointer transition-all"
          style={{
            backgroundColor: cfg.telemetrySource === 'simulation' ? '#c88bff15' : '#141414',
            border: `1px solid ${cfg.telemetrySource === 'simulation' ? '#c88bff66' : '#222'}`,
          }}
        >
          <div className="flex items-center justify-between">
            <span style={{ fontFamily: MONO, fontSize: 8.5, color: '#c88bff', fontWeight: 700 }}>
              SIMULATION
            </span>
            <div style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #c88bff', backgroundColor: cfg.telemetrySource === 'simulation' ? '#c88bff' : 'transparent' }} />
          </div>
          <span style={{ fontFamily: MONO, fontSize: 7, color: '#666', lineHeight: 1.4 }}>
            Synthetic 10 Hz vehicle dynamics generator.
          </span>
        </div>

        <div
          onClick={() => cfg.setTelemetrySource('websocket')}
          className="flex flex-col gap-1 p-2.5 rounded cursor-pointer transition-all"
          style={{
            backgroundColor: cfg.telemetrySource === 'websocket' ? '#00ff4115' : '#141414',
            border: `1px solid ${cfg.telemetrySource === 'websocket' ? '#00ff4166' : '#222'}`,
          }}
        >
          <div className="flex items-center justify-between">
            <span style={{ fontFamily: MONO, fontSize: 8.5, color: '#00ff41', fontWeight: 700 }}>
              LIVE WEBSOCKET
            </span>
            <div style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #00ff41', backgroundColor: cfg.telemetrySource === 'websocket' ? '#00ff41' : 'transparent' }} />
          </div>
          <span style={{ fontFamily: MONO, fontSize: 7, color: '#666', lineHeight: 1.4 }}>
            Direct network stream (CAN bridge, Wi-Fi, Cellular).
          </span>
        </div>

        <div
          onClick={() => cfg.setTelemetrySource('supabase')}
          className="flex flex-col gap-1 p-2.5 rounded cursor-pointer transition-all"
          style={{
            backgroundColor: cfg.telemetrySource === 'supabase' ? '#4488ff15' : '#141414',
            border: `1px solid ${cfg.telemetrySource === 'supabase' ? '#4488ff66' : '#222'}`,
          }}
        >
          <div className="flex items-center justify-between">
            <span style={{ fontFamily: MONO, fontSize: 8.5, color: '#4488ff', fontWeight: 700 }}>
              SUPABASE
            </span>
            <div style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #4488ff', backgroundColor: cfg.telemetrySource === 'supabase' ? '#4488ff' : 'transparent' }} />
          </div>
          <span style={{ fontFamily: MONO, fontSize: 7, color: '#666', lineHeight: 1.4 }}>
            Realtime Broadcast. Decoded JSON, ~1 Hz per group.
          </span>
        </div>
      </div>

      {/* WebSocket URL Config */}
      {cfg.telemetrySource === 'websocket' && (
        <div className="flex flex-col gap-2 p-2.5 rounded" style={{ backgroundColor: '#131313', border: '1px solid #222' }}>
          <span style={labelStyle}>WEBSOCKET SERVER URL</span>
          <div className="flex gap-1.5">
            <input
              value={cfg.wsUrl}
              onChange={e => cfg.setWsUrl(e.target.value)}
              placeholder="ws://localhost:8765"
              style={{ ...selectStyle, fontFamily: MONO, fontSize: 9 }}
            />
          </div>

          <div className="flex items-center gap-1.5 mt-1">
            <span style={{ fontFamily: MONO, fontSize: 7, color: '#444' }}>PRESETS:</span>
            {['ws://localhost:8765', 'ws://127.0.0.1:8765'].map(url => (
              <button
                key={url}
                onClick={() => cfg.setWsUrl(url)}
                style={{
                  fontFamily: MONO,
                  fontSize: 7,
                  color: '#4488ff',
                  backgroundColor: '#4488ff10',
                  border: '1px solid #4488ff30',
                  padding: '1px 5px',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                {url}
              </button>
            ))}
          </div>

          <div className="mt-2 p-2 rounded" style={{ backgroundColor: '#0c0c0c', border: '1px solid #1a1a1a' }}>
            <span style={{ fontFamily: MONO, fontSize: 7.5, color: '#555', display: 'block', marginBottom: 4 }}>
              To start the Python telemetry bridge in a terminal:
            </span>
            <code style={{ fontFamily: MONO, fontSize: 8, color: '#00ff41', display: 'block' }}>
              python3 telemetry_server/server.py --port 8765
            </code>
          </div>
        </div>
      )}

      {cfg.telemetrySource === 'supabase' && <SupabaseSourcePanel />}
    </div>
  )

  let body: React.ReactNode = null
  if (target.kind === 'chart') body = chartBody(target.id)
  else if (target.kind === 'gauges') body = <div className="flex flex-col gap-2">{gaugeEditor}</div>
  else if (target.kind === 'suspension') body = <div className="flex flex-col gap-3">{descriptor('Damper-velocity histograms for all four corners (FL/FR/RL/RR), binned rebound←→bump in mm/s from the live buffer.')}{layoutEditor(['suspension'])}</div>
  else if (target.kind === 'pedal') body = <div className="flex flex-col gap-3">{descriptor('Throttle, brake and battery-voltage bar meters. Warn/danger banding is automatic on the top of each bar. Add a math channel to derive a custom pedal metric.')}<MathQuickAdd onAdd={() => cfg.closeConfig()} /></div>
  else if (target.kind === 'gforce') body = <div className="flex flex-col gap-3">{descriptor('Lateral vs longitudinal G friction circle with a fading trail (last 70 samples). Ring scale fixed at 1G / 2G / 3G.')}<MathQuickAdd onAdd={() => cfg.closeConfig()} /></div>
  else if (target.kind === 'gps') body = <div className="flex flex-col gap-3">{descriptor('Circuit map with sector markers (S2/S3) and the start/finish line. The car follows measured lap fraction, not raw latitude/longitude.')}{cfg.telemetrySource === 'supabase' && descriptor('SDM26-cell-v1 has no lap time. GPS arrives as lat/lon reference plus delta and is listed in the source inspector; it does not move this map.')}{layoutEditor(['gps'])}</div>
  else if (target.kind === 'source') body = sourceEditor
  else body = (
    <div className="flex flex-col gap-2">
      <Section title="TELEMETRY SOURCE & NETWORK" open={open.source} onToggle={() => t('source')}>{sourceEditor}</Section>
      <Section title="CUSTOMIZE GAUGES" open={open.gauges} onToggle={() => t('gauges')}>{gaugeEditor}</Section>
      <Section title="ALERTS & WARNINGS" open={open.alerts} onToggle={() => t('alerts')}>{alertEditor}</Section>
      <Section title="MATH CHANNELS" open={open.math} onToggle={() => t('math')}>{mathEditor}</Section>
      <Section title="LAYOUT" open={open.layout} onToggle={() => t('layout')}>{layoutEditor()}</Section>
    </div>
  )

  return (
    <div onClick={cfg.closeConfig} className="flex items-center justify-center"
      style={{ position: 'fixed', inset: 0, backgroundColor: '#000000aa', zIndex: 80, animation: 'fadeIn 0.15s ease' }}>
      <div onClick={e => e.stopPropagation()} className="flex flex-col bg-[#0f0f0f]"
        style={{ width: 440, maxWidth: '92vw', maxHeight: '82vh', borderRadius: 8, border: '1px solid #2a2a2a', boxShadow: '0 24px 80px #000000dd, 0 0 40px #4488ff22', animation: 'popIn 0.16s cubic-bezier(0.2,0.9,0.3,1)', overflow: 'hidden' }}>
        {/* header */}
        <div className="flex items-center justify-between px-4 border-b border-[#1e1e1e]" style={{ height: 40, flexShrink: 0, background: 'linear-gradient(180deg, #141414, #0f0f0f)' }}>
          <div className="flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="2" stroke="#4488ff" strokeWidth="0.9" />
              {[0, 45, 90, 135, 180, 225, 270, 315].map(d => { const r = (d * Math.PI) / 180; return <line key={d} x1={6 + 2.7 * Math.cos(r)} y1={6 + 2.7 * Math.sin(r)} x2={6 + 4.2 * Math.cos(r)} y2={6 + 4.2 * Math.sin(r)} stroke="#4488ff" strokeWidth="1.2" strokeLinecap="round" /> })}
            </svg>
            <span style={{ fontFamily: MONO, fontSize: 9, color: '#4488ff', letterSpacing: '0.2em', fontWeight: 700 }}>{TITLE(target)}</span>
          </div>
          <button onClick={cfg.closeConfig} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontFamily: MONO, fontSize: 15 }}>✕</button>
        </div>

        {/* body */}
        <div className="overflow-y-auto p-4" style={{ flex: 1 }}>{body}</div>

        {/* footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[#242424]" style={{ flexShrink: 0, backgroundColor: '#0f0f0f' }}>
          {target.kind === 'all' && (
            <button onClick={cfg.reset} style={{ fontFamily: MONO, fontSize: 8, color: '#ff6644', backgroundColor: '#ff664410', border: '1px solid #ff664430', padding: '9px 12px', borderRadius: 5, cursor: 'pointer', letterSpacing: '0.15em', flexShrink: 0 }}>RESET</button>
          )}
          <button onClick={cfg.closeConfig} style={{ fontFamily: MONO, fontSize: 10, color: '#fff', background: 'linear-gradient(135deg, #4488ff, #2266dd)', border: 'none', padding: '10px', borderRadius: 5, cursor: 'pointer', letterSpacing: '0.2em', flex: 1, fontWeight: 700, boxShadow: '0 0 16px #4488ff44' }}>
            SAVE &amp; APPLY
          </button>
        </div>
      </div>
    </div>
  )
}

// Inline math-channel creator: name/unit/expr → appends to cfg.math and assigns.
function MathQuickAdd({ onAdd }: { onAdd: (mathId: string) => void }) {
  const cfg = useConfig()
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [expr, setExpr] = useState('')
  const valid = expr.trim() !== '' && isValidExpr(expr)
  const add = () => {
    if (!valid) return
    const id = `m${Date.now()}`
    cfg.setMath([...cfg.math, { id, name: name.trim() || 'Custom', unit: unit.trim(), expr }])
    setName(''); setUnit(''); setExpr('')
    onAdd(id)
  }
  return (
    <div className="flex flex-col gap-1.5 rounded p-2" style={{ backgroundColor: '#131313', border: '1px solid #1e1e1e' }}>
      <span style={labelStyle}>MATH EQUATION — DERIVE A NEW CHANNEL</span>
      <div className="flex gap-1.5">
        <input value={name} onChange={e => setName(e.target.value)} style={selectStyle} placeholder="name" />
        <input value={unit} onChange={e => setUnit(e.target.value)} style={{ ...selectStyle, width: 56, flexShrink: 0 }} placeholder="unit" />
      </div>
      <input value={expr} onChange={e => setExpr(e.target.value)}
        style={{ ...selectStyle, border: `1px solid ${expr === '' || valid ? '#2e2e2e' : '#ff3333'}`, color: valid ? '#c88bff' : '#999' }} placeholder="(wFL + wFR) / 2" />
      <div className="flex flex-wrap gap-1">
        {['speed', 'rpm', 'throttle', 'brake', 'gX', 'gY', 'volt', 'sqrt(', 'abs('].map(ch => (
          <span key={ch} onClick={() => setExpr(expr + ch)} style={{ fontFamily: MONO, fontSize: 7.5, color: '#4488ff', backgroundColor: '#4488ff14', padding: '2px 5px', borderRadius: 3, cursor: 'pointer', border: '1px solid #4488ff22' }}>{ch}</span>
        ))}
      </div>
      <button onClick={add} disabled={!valid} style={{ ...idBtn(valid ? '#c88bff' : '#444'), width: '100%', padding: '6px', cursor: valid ? 'pointer' : 'not-allowed', opacity: valid ? 1 : 0.5 }}>+ CREATE &amp; ASSIGN</button>
    </div>
  )
}

function SupabaseSourcePanel() {
  const cfg = useConfig()
  const telemetry = useTelemetryStatus()
  const diag = telemetry?.source === 'supabase' ? telemetry.diagnostics : null
  const age = diag?.lastAcceptedMs == null ? null : Date.now() - diag.lastAcceptedMs

  return (
    <div className="flex flex-col gap-2 p-2.5 rounded" style={{ backgroundColor: '#131313', border: '1px solid #222' }}>
      <span style={labelStyle}>SUPABASE REALTIME BROADCAST</span>
      <span style={{ fontFamily: MONO, fontSize: 7, color: '#555', lineHeight: 1.5 }}>
        Topic telemetry:live:&lt;session&gt;, event live. Publishable or anon key only. Do not paste a service-role key, a secret key, or TELEMETRY_HMAC_KEY. Switching session clears merged samples.
      </span>
      <label style={labelStyle}>PROJECT URL</label>
      <input value={cfg.supabaseUrl} onChange={e => cfg.setSupabaseUrl(e.target.value)} placeholder="https://YOUR_PROJECT.supabase.co" style={{ ...selectStyle, fontSize: 9 }} />
      <label style={labelStyle}>PUBLISHABLE / ANON KEY</label>
      <input type="password" value={cfg.supabaseAnonKey} onChange={e => cfg.setSupabaseAnonKey(e.target.value)} placeholder="sb_publishable_… or anon JWT" autoComplete="off" style={{ ...selectStyle, fontSize: 9 }} />
      <label style={labelStyle}>SESSION UUID</label>
      <input value={cfg.telemetrySessionId} onChange={e => cfg.setTelemetrySessionId(e.target.value)} placeholder="00000000-0000-4000-8000-000000000000" style={{ ...selectStyle, fontSize: 9 }} />
      <label style={labelStyle}>STALE AFTER (MS)</label>
      <input
        value={String(cfg.staleAfterMs)}
        onChange={e => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) cfg.setStaleAfterMs(Math.max(500, n))
        }}
        style={{ ...selectStyle, fontSize: 9 }}
      />
      <span style={{ fontFamily: MONO, fontSize: 7, color: '#444' }}>
        Default {DEFAULT_STALE_MS} ms. Groups broadcast about once per second, not at their 10 Hz sample rate. Host: {publicHost(cfg.supabaseUrl)}
      </span>

      <div className="mt-1 p-2 rounded flex flex-col gap-1" style={{ backgroundColor: '#0c0c0c', border: '1px solid #1a1a1a' }}>
        <span style={labelStyle}>DIAGNOSTICS</span>
        <span style={{ fontFamily: MONO, fontSize: 7.5, color: '#777', lineHeight: 1.55 }}>
          {diag
            ? `received ${diag.received} · accepted ${diag.accepted} · invalid ${diag.invalid} · old ${diag.ignoredOld} · rejected values ${diag.rejectedValues}`
            : 'Select this source to subscribe. Counts stay at zero until a live message arrives.'}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 7.5, color: '#777', lineHeight: 1.55 }}>
          {diag
            ? `groups [${diag.groupsSeen.join(', ') || '—'}] · last seq ${diag.lastSeq ?? '—'} · receipt ${fmtClock(diag.lastReceiptMs)} · accepted ${fmtClock(diag.lastAcceptedMs)} · sample age ${age == null ? '—' : `${age} ms local`}`
            : 'Subscribed is not the same as fresh. Broadcast does not replay a snapshot.'}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 7.5, color: '#666', lineHeight: 1.55 }}>
          {diag?.uplinkEstimateMs == null
            ? 'Timing estimates appear after the first accepted sample. They include clock skew.'
            : `uplink estimate ${Math.round(diag.uplinkEstimateMs)} ms · sample-age estimate ${diag.sampleAgeEstimateMs == null ? '—' : `${Math.round(diag.sampleAgeEstimateMs)} ms`} (clock skew, not measured latency)`}
        </span>
        {diag?.lastError && <span style={{ fontFamily: MONO, fontSize: 7.5, color: '#ff6644' }}>{diag.lastError}</span>}
      </div>

      <div className="p-2 rounded flex flex-col gap-1" style={{ backgroundColor: '#0c0c0c', border: '1px solid #1a1a1a' }}>
        <span style={labelStyle}>MAPPED FIELDS</span>
        <span style={{ fontFamily: MONO, fontSize: 7, color: '#666', lineHeight: 1.5 }}>
          {DASHBOARD_FIELD_MAPPINGS.map(m => `${m.field} ← ${m.channelId}${m.toDashboard === 1 ? '' : ' ×0.01'}`).join(' · ')}
        </span>
        <span style={labelStyle}>UNAVAILABLE ON THIS SET</span>
        <span style={{ fontFamily: MONO, fontSize: 7, color: '#555' }}>{UNMAPPED_DASHBOARD_FIELDS.join(', ')} — shown as —, not zero</span>
        <span style={labelStyle}>CHANNELS WITH NO DASHBOARD FIELD</span>
        <div className="flex flex-col gap-0.5" style={{ maxHeight: 140, overflowY: 'auto' }}>
          {(telemetry?.channelReadings ?? []).length === 0 && (
            <span style={{ fontFamily: MONO, fontSize: 7, color: '#555' }}>None received yet. Unknown ids are kept here and are not dropped or zeroed.</span>
          )}
          {(telemetry?.channelReadings ?? []).map(reading => {
            const def = LIVE_CHANNEL_MAP[reading.id]
            const mapped = DASHBOARD_FIELD_MAPPINGS.some(m => m.channelId === reading.id)
            return (
              <span key={reading.id} style={{ fontFamily: MONO, fontSize: 7, color: mapped ? '#666' : '#9bd' }}>
                {channelLabel(reading.id)}{def ? '' : ' (unknown id)'} = {reading.value} {def?.unit ?? ''}{mapped ? '' : ' · no dashboard field'}
              </span>
            )
          })}
          {telemetry && telemetry.channelReadings.length > 0 && <GpsInspection readings={telemetry.channelReadings} />}
        </div>
      </div>
    </div>
  )
}

function GpsInspection({ readings }: { readings: { id: string; value: number; tUs: number; receivedAtMs: number }[] }) {
  const state: ChannelState = {}
  for (const reading of readings) state[reading.id] = { value: reading.value, tUs: reading.tUs, receivedAtMs: reading.receivedAtMs }
  const gps = gpsPosition(state)
  if (!gps) return null
  return <span style={{ fontFamily: MONO, fontSize: 7, color: '#9bd' }}>gps.lat/lon reconstructed (ref + delta) = {gps.lat.toFixed(6)}, {gps.lon.toFixed(6)} · not a dashboard lap position</span>
}

function fmtClock(ms: number | null | undefined): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleTimeString()
}
