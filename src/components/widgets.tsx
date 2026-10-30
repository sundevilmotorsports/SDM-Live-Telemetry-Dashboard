import { useState, useEffect, useRef } from 'react'
import {
  Frame, MONO, BUFFER, HZ, clamp, fmtTime, fmtNum, CHANNEL_MAP, CHART_BASE_MAP, ChannelDef, frameScope,
  TRACK_PATH, TRACK_WP, S1_IDX, S2_IDX, interpolateTrack,
} from '../telemetry/simulation'
import { MathChannel, useConfig } from '../state/ConfigContext'
import { evalExpr } from '../telemetry/expression'
import { DraggableStack, StackItem } from './DraggableStack'

// Resolve any channel/math id to a value + display metadata for the given frame
export function resolveChannel(id: string, f: Frame, math: MathChannel[]): { value: number; def: Omit<ChannelDef, 'get'> } {
  if (id.startsWith('math:')) {
    const mc = math.find(m => m.id === id.slice(5))
    if (mc) {
      const value = evalExpr(mc.expr, frameScope(f))
      return { value: Number.isFinite(value) ? value : NaN, def: { id, label: mc.name, unit: mc.unit, min: 0, max: Math.max(1, Number.isFinite(value) ? value * 1.5 : 100), color: '#c88bff' } }
    }
  }
  const c = CHANNEL_MAP[id] ?? CHANNEL_MAP['speed']
  const { get, ...def } = c
  return { value: c.get(f), def }
}

// ── Widget Controls (drag handle + gear) ────────────────────────────────────
export function WidgetControls({ onConfig }: { onConfig?: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="widget-drag-handle" title="Drag to reorder widget"
        style={{ opacity: 0.28, cursor: 'grab', display: 'flex' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.28' }}>
        <svg width="8" height="12" viewBox="0 0 8 12">
          {([0, 4, 8] as number[]).flatMap(y => ([0, 3] as number[]).map(x => (
            <circle key={`${x}-${y}`} cx={x + 1.5} cy={y + 2} r="0.9" fill="#707070" />
          )))}
        </svg>
      </span>
      <button title="Configure widget" onClick={onConfig}
        style={{ opacity: 0.32, cursor: 'pointer', background: 'none', border: 'none', padding: 0, display: 'flex' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.32' }}>
        <svg width="11" height="11" viewBox="0 0 12 12">
          <circle cx="6" cy="6" r="2" fill="none" stroke="#8a8a8a" strokeWidth="0.9" />
          {([0, 45, 90, 135, 180, 225, 270, 315] as number[]).map(deg => {
            const r = (deg * Math.PI) / 180
            return <line key={deg} x1={6 + 2.7 * Math.cos(r)} y1={6 + 2.7 * Math.sin(r)} x2={6 + 4.2 * Math.cos(r)} y2={6 + 4.2 * Math.sin(r)} stroke="#8a8a8a" strokeWidth="1.1" strokeLinecap="round" />
          })}
        </svg>
      </button>
    </div>
  )
}

// ── Time Series Chart ────────────────────────────────────────────────────────
export interface ChartDef {
  label: string; unit: string; min: number; max: number
  getValue: (f: Frame) => number
  color: string
  gridTicks: number[]
  extraValues?: { get: (f: Frame) => number; color: string }[]
}

export function Chart({ frames, getValue, color, label, unit, min, max, crosshairFrac, gridTicks, extraValues, warningAt, dangerAt, onConfig }:
  ChartDef & { frames: Frame[]; crosshairFrac: number | null; warningAt?: number | null; dangerAt?: number | null; onConfig?: () => void }) {
  const W = 800, H = 100
  const span = max - min || 1
  const toY = (v: number) => (Number.isFinite(v) ? clamp(H - ((v - min) / span) * H, 0, H) : H)
  const fid = `gf${label.replace(/\W/g, '')}`
  const makePath = (getter: (f: Frame) => number) => {
    if (frames.length < 2) return ''
    let pen = false
    const parts: string[] = []
    frames.forEach((f, i) => {
      const v = getter(f)
      if (!Number.isFinite(v)) { pen = false; return }
      const x = ((i / (frames.length - 1)) * W).toFixed(1)
      parts.push(`${pen ? 'L' : 'M'} ${x} ${toY(v).toFixed(1)}`)
      pen = true
    })
    return parts.join(' ')
  }
  const current = frames.length ? getValue(frames[frames.length - 1]) : NaN
  const currentKnown = Number.isFinite(current)
  const crossIdx = crosshairFrac !== null ? Math.round(clamp(crosshairFrac, 0, 1) * (frames.length - 1)) : null
  const crossVal = crossIdx !== null && frames[crossIdx] ? getValue(frames[crossIdx]) : null
  let valColor = color
  if (dangerAt != null && current >= dangerAt) valColor = '#ff3333'
  else if (warningAt != null && current >= warningAt) valColor = '#ff8800'

  return (
    <div className="flex flex-col border-b border-[#242424] last:border-b-0" style={{ flex: 1 }}>
      <div className="panel-drag flex items-center justify-between px-2 border-b border-[#1c1c1c] bg-[#151515]" style={{ height: 19, cursor: 'grab', touchAction: 'none' }}>
        <div className="flex items-center gap-1.5">
          <div style={{ width: 14, height: 2, backgroundColor: color, opacity: 0.85 }} />
          <span style={{ fontFamily: MONO, fontSize: 9, color, letterSpacing: '0.15em', opacity: 0.9 }}>{label}</span>
        </div>
        <div className="flex items-center gap-3">
          {crossVal !== null && Number.isFinite(crossVal) && <span style={{ fontFamily: MONO, fontSize: 8, color: '#4a4a4a' }}>{crossVal.toFixed(1)} {unit}</span>}
          <span style={{ fontFamily: MONO, fontSize: 12, color: currentKnown ? valColor : '#555', fontWeight: 700 }}>
            {fmtNum(current, 1)}<span style={{ color: '#3a3a3a', fontSize: 9, marginLeft: 2 }}>{currentKnown ? unit : 'N/A'}</span>
          </span>
          <WidgetControls onConfig={onConfig} />
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden bg-[#191919]">
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <filter id={fid} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {gridTicks.map(v => {
            const y = toY(v)
            return (
              <g key={v}>
                <line x1={0} y1={y} x2={W} y2={y} stroke={v === 0 ? '#2c2c2c' : '#202020'} strokeWidth={v === 0 ? '1.5' : '0.5'} />
                <text x={6} y={Math.max(10, y - 3)} fontSize="7" fill="#282828" fontFamily="monospace">{v}</text>
              </g>
            )
          })}
          {extraValues?.map((ev, i) => <path key={i} d={makePath(ev.get)} fill="none" stroke={ev.color} strokeWidth="0.8" opacity="0.5" />)}
          <path d={makePath(getValue)} fill="none" stroke={color} strokeWidth="1.5" filter={`url(#${fid})`} />
          {crosshairFrac !== null && <line x1={crosshairFrac * W} y1={0} x2={crosshairFrac * W} y2={H} stroke="#ffffff" strokeWidth="0.6" opacity="0.2" strokeDasharray="4 4" />}
          {currentKnown && <rect x={W - 2} y={clamp(toY(current) - 5, 0, H - 10)} width="3" height="10" fill={color} opacity="0.9" />}
        </svg>
      </div>
    </div>
  )
}

// ── Left Panel ────────────────────────────────────────────────────────────────
export function LeftPanel({ frames, syncCrosshair }: { frames: Frame[]; syncCrosshair: boolean }) {
  const [crossX, setCrossX] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const { chartOrder, chartCfg, math, openConfig, setChartOrder } = useConfig()

  const items: StackItem[] = (chartOrder.map(id => {
    const base = CHART_BASE_MAP[id]
    if (!base) return null
    const stored = chartCfg[id]
    const cfg = {
      channel: stored?.channel ?? base.channel,
      color: stored?.color ?? base.color,
      min: Number.isFinite(stored?.min) ? stored!.min : base.min,
      max: Number.isFinite(stored?.max) ? stored!.max : base.max,
      warnAt: stored?.warnAt ?? null,
      dangerAt: stored?.dangerAt ?? null,
    }
    const { def } = resolveChannel(cfg.channel, frames[frames.length - 1] ?? ({} as Frame), math)
    const extraValues = base.extra?.map(e => ({ get: (f: Frame) => (CHANNEL_MAP[e.channel]?.get(f) ?? 0), color: e.color }))
    return {
      id, title: base.label, weight: 1,
      node: (
        <Chart
          frames={frames} crosshairFrac={crossX}
          label={base.label} unit={def.unit} color={cfg.color} min={cfg.min} max={cfg.max}
          gridTicks={base.gridTicks} extraValues={extraValues}
          warningAt={cfg.warnAt} dangerAt={cfg.dangerAt}
          getValue={f => resolveChannel(cfg.channel, f, math).value}
          onConfig={() => openConfig({ kind: 'chart', id })}
        />
      ),
    }
  }) as (StackItem | null)[]).filter((x): x is StackItem => x !== null)

  return (
    <div ref={ref} className="flex flex-col h-full"
      onMouseMove={e => { if (!syncCrosshair) return; const r = ref.current?.getBoundingClientRect(); if (r) setCrossX((e.clientX - r.left) / r.width) }}
      onMouseLeave={() => setCrossX(null)}>
      <div className="flex items-center justify-between px-3 border-b border-[#242424] bg-[#111111]" style={{ height: 20 }}>
        <span style={{ fontFamily: MONO, fontSize: 8, color: '#2e2e2e', letterSpacing: '0.25em' }}>TIME SERIES — {(BUFFER / HZ).toFixed(0)}s WINDOW</span>
        <div className="flex items-center gap-3">
          {([['FL', '#00ffff'], ['FR', '#00cccc'], ['RL', '#33ffee'], ['RR', '#009999']] as [string, string][]).map(([lbl, col]) => (
            <div key={lbl} className="flex items-center gap-1">
              <div style={{ width: 10, height: 2, backgroundColor: col }} /><span style={{ fontFamily: MONO, fontSize: 7, color: '#333' }}>{lbl}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col flex-1 overflow-hidden">
        <DraggableStack items={items} onReorder={setChartOrder} />
      </div>
    </div>
  )
}

// ── Arc Gauge ──────────────────────────────────────────────────────────────
export function ArcGauge({ value, min, max, label, unit, color, warningAt, dangerAt, dp = 0 }: {
  value: number; min: number; max: number; label: string; unit: string; color: string
  warningAt?: number | null; dangerAt?: number | null; dp?: number
}) {
  const cx = 60, cy = 70, r = 50
  const startDeg = -220, endDeg = 40, sweep = endDeg - startDeg
  const span = max - min || 1
  const known = Number.isFinite(value)
  if (!known) value = min
  const toRad = (d: number) => (d * Math.PI) / 180
  const degForVal = (v: number) => startDeg + clamp((v - min) / span, 0, 1) * sweep
  const arc = (sd: number, ed: number, ri = r) => {
    const x1 = cx + ri * Math.cos(toRad(sd)), y1 = cy + ri * Math.sin(toRad(sd))
    const x2 = cx + ri * Math.cos(toRad(ed)), y2 = cy + ri * Math.sin(toRad(ed))
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${ri} ${ri} 0 ${Math.abs(ed - sd) > 180 ? 1 : 0} ${ed > sd ? 1 : 0} ${x2.toFixed(2)} ${y2.toFixed(2)}`
  }
  const needleDeg = degForVal(value), needleRad = toRad(needleDeg), nLen = r - 9
  let fg = color
  if (dangerAt != null && value >= dangerAt) fg = '#ff3333'
  else if (warningAt != null && value >= warningAt) fg = '#ff8800'
  const totalTicks = 24
  const ticks = Array.from({ length: totalTicks + 1 }, (_, i) => {
    const frac = i / totalTicks, deg = startDeg + frac * sweep, rad = toRad(deg)
    const major = i % 4 === 0, inner = r - (major ? 11 : 6)
    return { x1: cx + inner * Math.cos(rad), y1: cy + inner * Math.sin(rad), x2: cx + r * Math.cos(rad), y2: cy + r * Math.sin(rad), major, tickVal: (min + frac * (max - min)).toFixed(0), lx: cx + (inner - 8) * Math.cos(rad), ly: cy + (inner - 8) * Math.sin(rad) }
  })
  const fid = `gg${label.replace(/\W/g, '')}`
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <svg viewBox="0 0 120 108" style={{ width: '100%', maxHeight: 185 }}>
        <defs>
          <filter id={fid} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path d={arc(startDeg, endDeg)} fill="none" stroke="#1c1c1c" strokeWidth="7" />
        {dangerAt != null && <path d={arc(degForVal(dangerAt), endDeg)} fill="none" stroke="#ff333320" strokeWidth="7" />}
        {warningAt != null && <path d={arc(degForVal(warningAt), dangerAt != null ? degForVal(dangerAt) : endDeg)} fill="none" stroke="#ff880018" strokeWidth="7" />}
        {known && <path d={arc(startDeg, needleDeg)} fill="none" stroke={fg} strokeWidth="7" opacity="0.72" filter={`url(#${fid})`} />}
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} stroke={tk.major ? '#3e3e3e' : '#272727'} strokeWidth={tk.major ? '1' : '0.5'} />
            {tk.major && <text x={tk.lx} y={tk.ly + 2} textAnchor="middle" fontSize="4.5" fill="#303030" fontFamily="monospace">{tk.tickVal}</text>}
          </g>
        ))}
        {known && <line x1={cx - 4 * Math.cos(needleRad)} y1={cy - 4 * Math.sin(needleRad)} x2={cx + nLen * Math.cos(needleRad)} y2={cy + nLen * Math.sin(needleRad)} stroke="rgba(0,0,0,0.7)" strokeWidth="4" strokeLinecap="round" />}
        {known && <line x1={cx - 4 * Math.cos(needleRad)} y1={cy - 4 * Math.sin(needleRad)} x2={cx + nLen * Math.cos(needleRad)} y2={cy + nLen * Math.sin(needleRad)} stroke={fg} strokeWidth="2" strokeLinecap="round" filter={`url(#${fid})`} />}
        <circle cx={cx} cy={cy} r="6.5" fill="#111111" stroke="#2a2a2a" strokeWidth="1" />
        <circle cx={cx} cy={cy} r="2.5" fill={known ? fg : '#333'} filter={`url(#${fid})`} />
        <text x={cx} y={cy + 21} textAnchor="middle" fontSize="17" fontWeight="700" fill={known ? fg : '#555'} fontFamily="monospace">{known ? value.toFixed(dp) : '—'}</text>
        <text x={cx} y={cy + 31} textAnchor="middle" fontSize="6" fill="#3a3a3a" fontFamily="monospace">{unit}</text>
        <text x={cx} y={cy + 42} textAnchor="middle" fontSize="4.5" fill="#2e2e2e" fontFamily="monospace" letterSpacing="2">{label.toUpperCase()}</text>
      </svg>
    </div>
  )
}

// ── Vertical Bar Meter ─────────────────────────────────────────────────────
export function VBar({ value, min = 0, max, label, unit, color, noTopDanger }: {
  value: number; min?: number; max: number; label: string; unit: string; color: string; noTopDanger?: boolean
}) {
  const SEGS = 20
  const known = Number.isFinite(value)
  const filled = known ? Math.round(clamp((value - min) / (max - min), 0, 1) * SEGS) : 0
  return (
    <div className="flex flex-col items-center gap-1" style={{ flex: 1 }}>
      <div style={{ fontFamily: MONO, fontSize: 8, color: '#444', letterSpacing: '0.2em' }}>{label}</div>
      <div className="flex flex-col-reverse" style={{ gap: 2 }}>
        {Array.from({ length: SEGS }, (_, i) => {
          const active = i < filled
          const danger = !noTopDanger && i >= SEGS * 0.88
          const warn = !noTopDanger && !danger && i >= SEGS * 0.7
          const segColor = active ? (danger ? '#ff3333' : warn ? '#ff8800' : color) : '#1c1c1c'
          return <div key={i} style={{ width: 24, height: 5, borderRadius: 1, backgroundColor: segColor, opacity: active ? 1 : 0.18, boxShadow: active ? `0 0 5px ${segColor}88` : 'none' }} />
        })}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 11, color, fontWeight: 700 }}>
        {known ? value.toFixed(noTopDanger ? 1 : 0) : '—'}<span style={{ color: '#383838', fontSize: 8 }}>{known ? unit : 'N/A'}</span>
      </div>
    </div>
  )
}

// ── Friction Circle ──────────────────────────────────────────────────────────
export function FrictionCircle({ frames }: { frames: Frame[] }) {
  const MAX_G = 3, cx = 50, cy = 50, r = 44
  const toXY = (gx: number, gy: number): [number, number] => [cx + (gx / MAX_G) * r, cy - (gy / MAX_G) * r]
  const trail = frames.slice(-70), cur = frames[frames.length - 1]
  return (
    <div className="flex flex-col items-center w-full">
      <svg viewBox="0 0 100 100" style={{ width: '100%', maxHeight: 160 }}>
        <defs>
          <filter id="gcirc" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {[1, 2, 3].map(g => <circle key={g} cx={cx} cy={cy} r={r * g / MAX_G} fill="none" stroke={g === MAX_G ? '#272727' : '#1e1e1e'} strokeWidth={g === MAX_G ? '0.8' : '0.4'} strokeDasharray={g < MAX_G ? '2 3' : '0'} />)}
        <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="#1d1d1d" strokeWidth="0.5" />
        <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="#1d1d1d" strokeWidth="0.5" />
        <text x={cx + r * (1 / 3) + 1.5} y={cy - 1} fontSize="3.5" fill="#252525" fontFamily="monospace">1G</text>
        <text x={cx + r * (2 / 3) + 1.5} y={cy - 1} fontSize="3.5" fill="#252525" fontFamily="monospace">2G</text>
        <text x={cx} y={5.5} textAnchor="middle" fontSize="3.5" fill="#2e2e2e" fontFamily="monospace">+Gy ACCEL</text>
        <text x={cx} y={98} textAnchor="middle" fontSize="3.5" fill="#2e2e2e" fontFamily="monospace">-Gy BRAKE</text>
        <text x={2} y={cy + 1.5} fontSize="3" fill="#2a2a2a" fontFamily="monospace">-Gx</text>
        <text x={85} y={cy + 1.5} fontSize="3" fill="#2a2a2a" fontFamily="monospace">+Gx</text>
        {trail.map((f, i) => {
          if (!Number.isFinite(f.gX) || !Number.isFinite(f.gY)) return null
          const [x, y] = toXY(f.gX, f.gY)
          return <circle key={i} cx={x} cy={y} r="0.75" fill="#00ffff" opacity={(i / trail.length) * 0.85} />
        })}
        {cur && Number.isFinite(cur.gX) && Number.isFinite(cur.gY) && (() => { const [x, y] = toXY(cur.gX, cur.gY); return <><circle cx={x} cy={y} r="4" fill="#00ffff" opacity="0.12" /><circle cx={x} cy={y} r="2" fill="#00ffff" filter="url(#gcirc)" /></> })()}
      </svg>
    </div>
  )
}

// ── GPS Track Map ────────────────────────────────────────────────────────────
export function GpsTrackMap({ lapFrac }: { lapFrac: number }) {
  const hasLap = Number.isFinite(lapFrac)
  const [carX, carY] = interpolateTrack(hasLap ? lapFrac : 0)
  const [s1x, s1y] = TRACK_WP[S1_IDX], [s2x, s2y] = TRACK_WP[S2_IDX]
  return (
    <div className="flex flex-col items-center w-full h-full">
      <svg viewBox="0 0 200 140" style={{ width: '100%', height: '100%' }}>
        <defs>
          <filter id="car-glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <path d={TRACK_PATH} fill="none" stroke="#00ffff08" strokeWidth="22" strokeLinejoin="round" strokeLinecap="round" />
        <path d={TRACK_PATH} fill="none" stroke="#363636" strokeWidth="14.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={TRACK_PATH} fill="none" stroke="#252525" strokeWidth="12" strokeLinejoin="round" strokeLinecap="round" />
        <path d={TRACK_PATH} fill="none" stroke="#1e1e1e" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="6 8" />
        <line x1={30} y1={113} x2={30} y2={127} stroke="#ffffff" strokeWidth="1.5" opacity="0.5" />
        <line x1={36} y1={113} x2={36} y2={127} stroke="#ff3333" strokeWidth="1.5" opacity="0.5" />
        <circle cx={s1x} cy={s1y} r="2.5" fill="#ffff00" opacity="0.4" />
        <circle cx={s2x} cy={s2y} r="2.5" fill="#00ffff" opacity="0.4" />
        <text x={s1x + 4} y={s1y + 1} fontSize="4" fill="#ffff0055" fontFamily="monospace">S2</text>
        <text x={s2x + 4} y={s2y + 1} fontSize="4" fill="#00ffff55" fontFamily="monospace">S3</text>
        <text x={38} y={127} fontSize="4" fill="#ffffff44" fontFamily="monospace">S/F</text>
        {hasLap && <circle cx={carX} cy={carY} r="7" fill="#00ffff" opacity="0.08" filter="url(#car-glow)" />}
        {hasLap && <circle cx={carX} cy={carY} r="4" fill="#00ffff" opacity="0.15" />}
        {hasLap && <circle cx={carX} cy={carY} r="2.5" fill="#00ffff" filter="url(#car-glow)" />}
        <text x={100} y={136} textAnchor="middle" fontSize="5" fill="#2a2a2a" fontFamily="monospace" letterSpacing="2">{hasLap ? 'GPS CIRCUIT MAP' : 'NO MEASURED LAP POSITION'}</text>
      </svg>
    </div>
  )
}

// ── Suspension Histogram ─────────────────────────────────────────────────────
const SUSP_MIN = -400, SUSP_MAX = 400, SUSP_BINS = 26
export function SuspHistogram({ frames, getVal, label, color }: { frames: Frame[]; getVal: (f: Frame) => number; label: string; color: string }) {
  const binSize = (SUSP_MAX - SUSP_MIN) / SUSP_BINS
  const counts = new Array(SUSP_BINS).fill(0)
  for (const f of frames) {
    const v = getVal(f)
    if (!Number.isFinite(v)) continue
    const idx = Math.floor((v - SUSP_MIN) / binSize)
    if (idx >= 0 && idx < SUSP_BINS) counts[idx]++
  }
  const maxCount = Math.max(...counts, 1)
  const W = 200, H = SUSP_BINS * 6, cx = W / 2
  const fid = `sh${label.replace(/\W/g, '')}`
  const rawCur = frames.length ? getVal(frames[frames.length - 1]) : NaN
  const curKnown = Number.isFinite(rawCur)
  const cur = curKnown ? rawCur : 0
  return (
    <div className="flex flex-col border-r border-b border-[#222] last:border-r-0" style={{ flex: 1 }}>
      <div className="flex items-center justify-between px-2 border-b border-[#1c1c1c] bg-[#111]" style={{ height: 18 }}>
        <div className="flex items-center gap-1.5">
          <div style={{ width: 8, height: 2, backgroundColor: color, opacity: 0.9 }} />
          <span style={{ fontFamily: MONO, fontSize: 8, color, letterSpacing: '0.18em', opacity: 0.9 }}>{label}</span>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 9, color, fontWeight: 700 }}>
          {curKnown ? `${cur >= 0 ? '+' : ''}${cur.toFixed(0)}` : '—'}<span style={{ color: '#383838', fontSize: 7, marginLeft: 1 }}>{curKnown ? 'mm/s' : 'N/A'}</span>
        </span>
      </div>
      <div className="relative flex-1 bg-[#191919]">
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <filter id={fid} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {[-W / 4, W / 4].map(ox => <line key={ox} x1={cx + ox} y1={0} x2={cx + ox} y2={H} stroke="#1e1e1e" strokeWidth="0.5" strokeDasharray="3 3" />)}
          <line x1={cx} y1={0} x2={cx} y2={H} stroke="#303030" strokeWidth="1" />
          <text x={4} y={6} fontSize="4" fill="#2a2a2a" fontFamily="monospace">REBOUND</text>
          <text x={W - 4} y={6} fontSize="4" fill="#2a2a2a" fontFamily="monospace" textAnchor="end">BUMP</text>
          {counts.map((count, i) => {
            if (count === 0) return null
            const barHalf = (count / maxCount) * (cx - 6)
            const binCenter = SUSP_MIN + (i + 0.5) * binSize
            const isNeg = binCenter < 0
            const y = i * (H / SUSP_BINS), bH = (H / SUSP_BINS) - 0.8, intensity = count / maxCount
            return <rect key={i} x={isNeg ? cx - barHalf : cx} y={y} width={Math.max(1, barHalf)} height={bH} fill={color} opacity={0.25 + intensity * 0.65} filter={intensity > 0.4 ? `url(#${fid})` : undefined} />
          })}
          {curKnown && (() => {
            const idx = Math.floor((clamp(cur, SUSP_MIN, SUSP_MAX) - SUSP_MIN) / binSize)
            const y = (idx + 0.5) * (H / SUSP_BINS)
            return <><line x1={cx - 6} y1={y} x2={cx + 6} y2={y} stroke={color} strokeWidth="1.2" /><circle cx={cx} cy={y} r="1.5" fill={color} filter={`url(#${fid})`} /></>
          })()}
        </svg>
      </div>
    </div>
  )
}

// ── Status Bar ────────────────────────────────────────────────────────────────
export interface ActiveAlert { id: string; severity: 'warn' | 'danger'; message: string }

export function StatusBar({
  cur,
  alerts,
  connectionStatus = 'simulated',
  packetRate = 10,
  source = 'simulation',
  freshness = 'fresh',
  onToggleSource,
  onOpenConfig,
}: {
  cur: Frame | undefined
  alerts: ActiveAlert[]
  connectionStatus?: 'simulated' | 'connecting' | 'connected' | 'subscribed' | 'reconnecting' | 'disconnected' | 'error' | 'misconfigured'
  packetRate?: number
  source?: 'simulation' | 'websocket' | 'supabase'
  freshness?: 'no-data' | 'fresh' | 'stale'
  onToggleSource?: () => void
  onOpenConfig?: () => void
}) {
  const [blink, setBlink] = useState(true)
  useEffect(() => { const id = setInterval(() => setBlink(p => !p), 420); return () => clearInterval(id) }, [])
  const danger = alerts.find(a => a.severity === 'danger') ?? alerts[0]

  const isWs = source === 'websocket'
  const isSb = source === 'supabase'
  const isLive = isWs || isSb
  const isConn = connectionStatus === 'connected' || connectionStatus === 'subscribed'
  const isErr = connectionStatus === 'disconnected' || connectionStatus === 'error' || connectionStatus === 'misconfigured'
  const isStale = isSb && isConn && freshness !== 'fresh'

  const statusColor = !isLive
    ? '#c88bff'
    : isErr
    ? '#ff3333'
    : isStale || !isConn
    ? '#ffaa00'
    : '#00ff41'

  const statusText = !isLive
    ? 'SIMULATION MODE'
    : isWs
    ? (connectionStatus === 'connected'
      ? `LIVE WS · ${packetRate} HZ`
      : connectionStatus === 'disconnected'
      ? 'WS RECONNECTING...'
      : 'CONNECTING TO WS...')
    : connectionStatus === 'misconfigured'
    ? 'SUPABASE CONFIG'
    : connectionStatus === 'error'
    ? 'REALTIME ERROR'
    : connectionStatus === 'reconnecting' || connectionStatus === 'disconnected'
    ? 'REALTIME RECONNECTING'
    : connectionStatus !== 'subscribed'
    ? 'CONNECTING REALTIME'
    : freshness === 'fresh'
    ? `LIVE · ${packetRate} MSG/S`
    : freshness === 'stale'
    ? 'SUBSCRIBED · STALE'
    : 'SUBSCRIBED · NO DATA'

  return (
    <div className="flex items-center border-b border-[#242424] bg-[#101010]" style={{ height: 28, flexShrink: 0 }}>
      {/* Interactive Source & Connection Pill */}
      <div className="flex items-center gap-2 px-3 border-r border-[#222] h-full">
        <button
          onClick={onOpenConfig}
          className="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer"
          title="Click to configure telemetry source"
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: statusColor,
              boxShadow: isConn || !isLive ? `0 0 8px ${statusColor}` : blink ? `0 0 8px ${statusColor}` : 'none',
              opacity: isErr && !blink ? 0.3 : 1,
              transition: 'all 0.2s',
            }}
          />
          <span style={{ fontFamily: MONO, fontSize: 8, color: statusColor, letterSpacing: '0.15em', fontWeight: 700 }}>
            {statusText}
          </span>
        </button>

        {onToggleSource && (
          <button
            onClick={onToggleSource}
            title={source === 'simulation' ? 'Switch to live WebSocket' : source === 'websocket' ? 'Switch to Supabase Broadcast' : 'Switch to local simulation'}
            style={{
              fontFamily: MONO,
              fontSize: 7,
              color: isLive ? '#c88bff' : '#00ff41',
              backgroundColor: isLive ? '#c88bff14' : '#00ff4114',
              border: `1px solid ${isLive ? '#c88bff44' : '#00ff4144'}`,
              borderRadius: 3,
              padding: '1px 5px',
              cursor: 'pointer',
              letterSpacing: '0.1em',
            }}
          >
            {source === 'simulation' ? '⇄ WS' : source === 'websocket' ? '⇄ SB' : '⇄ SIM'}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-3 border-r border-[#222] h-full">
        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#0088ff', boxShadow: '0 0 6px #0088ff55' }} />
        <span style={{ fontFamily: MONO, fontSize: 8, color: '#0088ff', letterSpacing: '0.15em' }}>
          {source === 'supabase' ? 'SUPABASE' : source === 'websocket' ? 'CELLULAR/LAN' : 'SYNTHETIC'}
        </span>
      </div>

      {cur && ([
        { label: 'LAP', val: Number.isFinite(cur.lapNum) ? String(cur.lapNum) : '—', color: '#e0e0e0' },
        { label: 'L-TIME', val: fmtTime(cur.lapTime), color: '#00ffff' },
        { label: 'SESSION', val: fmtTime(cur.t), color: '#606060' },
        { label: 'GEAR', val: Number.isFinite(cur.gear) ? String(Math.round(cur.gear)) : '—', color: '#ffff00', large: true },
        { label: 'FUEL', val: Number.isFinite(cur.fuel) ? `${cur.fuel.toFixed(0)}%` : '—', color: Number.isFinite(cur.fuel) && cur.fuel < 15 ? '#ff3333' : '#888' },
      ] as { label: string; val: string; color: string; large?: boolean }[]).map(({ label, val, color, large }) => (
        <div key={label} className="flex items-center gap-1.5 px-3 border-r border-[#1e1e1e] h-full">
          <span style={{ fontFamily: MONO, fontSize: 7.5, color: '#303030', letterSpacing: '0.1em' }}>{label}</span>
          <span style={{ fontFamily: MONO, fontSize: large ? 14 : 11, color, fontWeight: 700, lineHeight: 1 }}>{val}</span>
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {danger && (
        <div className="flex items-center gap-2 px-3 h-full border-l border-[#222]"
          style={{ backgroundColor: blink ? (danger.severity === 'danger' ? '#ff333314' : '#ff880014') : 'transparent', transition: 'background 0.2s' }}>
          {alerts.length > 1 && <span style={{ fontFamily: MONO, fontSize: 8, color: '#666' }}>+{alerts.length - 1}</span>}
          <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: danger.severity === 'danger' ? '#ff3333' : '#ff8800', boxShadow: blink ? `0 0 10px ${danger.severity === 'danger' ? '#ff3333' : '#ff8800'}` : 'none', transition: 'box-shadow 0.2s' }} />
          <span style={{ fontFamily: MONO, fontSize: 9, color: danger.severity === 'danger' ? '#ff3333' : '#ff8800', fontWeight: 700, letterSpacing: '0.1em', opacity: blink ? 1 : 0.35, transition: 'opacity 0.2s' }}>
            !!! {danger.message}
          </span>
        </div>
      )}
      <div className="flex items-center px-3 h-full border-l border-[#1e1e1e]">
        <span style={{ fontFamily: MONO, fontSize: 7, color: '#333', letterSpacing: '0.2em' }}>TELEMETRY BRIDGE v2.5</span>
      </div>
    </div>
  )
}
