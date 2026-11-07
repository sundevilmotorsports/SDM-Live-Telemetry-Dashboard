import { useEffect, useMemo, useRef, useState } from 'react'
import { MONO, Frame, CHANNELS, clamp, fmtNum } from '../telemetry/simulation'
import { useConfig, type ChartConfig, type DropTarget, type MathChannel } from '../state/ConfigContext'
import type { Telemetry } from '../telemetry/useTelemetry'
import { lapsFromFrames, lapsFromMarks, lapLength, bestLap, type LapSpan } from '../telemetry/laps'
import {
  buildView, clipSeries, inspectChart, fmtDuration, panRange, panY, scaleTicks, tracePath, viewBounds, zoomRange, zoomY,
  FULL_Y, WINDOW_PRESETS_S, type ChartView, type ChartInspection, type RangeMode, type XRange, type YWindow,
} from '../telemetry/chartView'
import { useLapMarks } from '../hooks/useLapMarks'
import { DraggableStack, type StackItem } from './DraggableStack'
import { WidgetControls, resolveChannel } from './widgets'
import { LegendWarnings } from './TelemetryAlerts'

const W = 800
const H = 100
const MIN_SPAN_S = 0.5
const CHANNEL_MIME = 'application/x-sdm-channel'
const TRACE_MIME = 'application/x-sdm-trace'

function btn(active: boolean, color = '#4488ff'): React.CSSProperties {
  return {
    fontFamily: MONO, fontSize: 8, letterSpacing: '0.12em', padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
    color: active ? color : '#555', backgroundColor: active ? `${color}18` : 'transparent',
    border: `1px solid ${active ? `${color}55` : '#262626'}`,
  }
}
const inputStyle: React.CSSProperties = {
  backgroundColor: '#161616', color: '#999', border: '1px solid #262626', fontFamily: MONO, fontSize: 8,
  padding: '1px 4px', borderRadius: 3, outline: 'none',
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

const isOurDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(CHANNEL_MIME) || e.dataTransfer.types.includes(TRACE_MIME)

/** Read a channel or trace drag and hand it to the config as a drop. */
function performDrop(e: React.DragEvent, target: DropTarget, dropChannel: (c: string, t: DropTarget) => void, dropTrace: (id: string, i: number, t: DropTarget) => void) {
  e.preventDefault()
  const channel = e.dataTransfer.getData(CHANNEL_MIME)
  if (channel) { dropChannel(channel, target); return }
  try {
    const t = JSON.parse(e.dataTransfer.getData(TRACE_MIME)) as { chartId: string; index: number }
    if (typeof t.chartId === 'string' && Number.isInteger(t.index)) dropTrace(t.chartId, t.index, target)
  } catch { /* not ours */ }
}

type Zone = 'above' | 'into' | 'below'

// ── Channel list (drag source, like MoTeC's channels pane) ──────────────────────
function ChannelList({ onClose, charted, onDragState }: { onClose: () => void; charted: Set<string>; onDragState: (on: boolean) => void }) {
  const { math, dropChannel, chartOrder } = useConfig()
  const [q, setQ] = useState('')
  const all = [
    ...CHANNELS.map(c => ({ id: c.id, label: c.label, unit: c.unit, color: c.color })),
    ...math.map(m => ({ id: `math:${m.id}`, label: `∑ ${m.name}`, unit: m.unit, color: '#c88bff' })),
  ]
  const needle = q.trim().toLowerCase()
  const shown = needle ? all.filter(c => c.label.toLowerCase().includes(needle) || c.id.toLowerCase().includes(needle)) : all
  return (
    <div className="flex flex-col border-r border-[#242424] bg-[#121212]" style={{ width: 138, flexShrink: 0 }}>
      <div className="flex items-center justify-between px-2 border-b border-[#1e1e1e]" style={{ height: 20 }}>
        <span style={{ fontFamily: MONO, fontSize: 8, color: '#4a4a4a', letterSpacing: '0.2em' }}>CHANNELS</span>
        <button onClick={onClose} title="Hide channel list" style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontFamily: MONO, fontSize: 10 }}>‹</button>
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="search…" style={{ ...inputStyle, margin: 4 }} />
      <div className="flex-1 overflow-y-auto">
        {shown.map(c => (
          <div key={c.id} draggable title="Drag onto a chart to overlay it, or onto a chart's top/bottom edge for a new chart. Double-click: new chart."
            onDragStart={e => { e.dataTransfer.setData(CHANNEL_MIME, c.id); e.dataTransfer.effectAllowed = 'copy'; onDragState(true) }}
            onDragEnd={() => onDragState(false)}
            onDoubleClick={() => dropChannel(c.id, { kind: 'new', index: chartOrder.length })}
            className="flex items-center gap-1.5 px-2 hover:bg-[#1c1c1c]" style={{ height: 17, cursor: 'grab' }}>
            <span style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: c.color, flexShrink: 0 }} />
            <span style={{ fontFamily: MONO, fontSize: 8, color: charted.has(c.id) ? '#999' : '#5a5a5a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
            {c.unit && <span style={{ fontFamily: MONO, fontSize: 7, color: '#333', marginLeft: 'auto', flexShrink: 0 }}>{c.unit}</span>}
          </div>
        ))}
      </div>
      <div className="px-2 py-1 border-t border-[#1e1e1e]" style={{ fontFamily: MONO, fontSize: 7, color: '#333', lineHeight: 1.5 }}>
        DRAG ONTO A CHART TO OVERLAY · ONTO AN EDGE FOR A NEW CHART
      </div>
    </div>
  )
}

// ── Group chart ────────────────────────────────────────────────────────────────
function GroupChart({ chartId, position, chart, view, range, crossFrac, math, dragging, onConfig, onToggleHidden, onDragState }: {
  chartId: string
  position: number
  chart: ChartConfig
  view: ChartView
  range: XRange
  crossFrac: number | null
  math: MathChannel[]
  dragging: boolean
  onConfig: () => void
  onToggleHidden: (index: number) => void
  onDragState: (on: boolean) => void
}) {
  const { dropChannel, dropTrace } = useConfig()
  const [highlight, setHighlight] = useState<number | null>(null)
  const [yWin, setYWin] = useState<YWindow>(FULL_Y)
  const [zone, setZone] = useState<Zone | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const axisDrag = useRef<{ y: number; win: YWindow } | null>(null)

  // Option/Alt + wheel: vertical zoom around the cursor (native listener so it can preventDefault).
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      const r = el.getBoundingClientRect()
      const frac = 1 - (e.clientY - r.top) / r.height
      if (e.shiftKey) setYWin(w => panY(w, (e.deltaY / r.height) * (w.hi - w.lo)))
      else setYWin(w => zoomY(w, frac, Math.exp(e.deltaY * 0.002)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const primary = view.series.find(s => s.role === 'primary') ?? null
  const latest = primary?.frames[primary.frames.length - 1]
  const crossX = crossFrac !== null ? range.xMin + clamp(crossFrac, 0, 1) * (range.xMax - range.xMin) : null
  const inspection = inspectChart(view, range, crossFrac)
  const sample = latest ?? ({} as Frame)
  const zoomedY = yWin.lo !== 0 || yWin.hi !== 1

  const traces = chart.traces.map((trace, index) => {
    const { def } = resolveChannel(trace.channel, sample, math)
    const get = (f: Frame) => resolveChannel(trace.channel, f, math).value
    const span = trace.max - trace.min || 1
    const lo = trace.min + yWin.lo * span
    const hi = trace.min + yWin.hi * span
    const toY = (v: number) => clamp(H - ((v - lo) / (hi - lo || 1)) * H, -2, H + 2)
    return { trace, index, def, get, toY, lo, hi }
  })
  const visible = traces.filter(t => !t.trace.hidden)
  const highlighted = highlight !== null && visible.some(t => t.index === highlight) ? highlight : null
  const axis = traces.find(t => t.index === highlighted) ?? visible[0] ?? null
  const glowId = `glow-${chartId.replace(/\W/g, '')}`
  const clipped = view.series.map(s => clipSeries(s, range.xMin, range.xMax))

  const zoneOf = (e: React.DragEvent): Zone => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = (e.clientY - r.top) / r.height
    return f < 0.22 ? 'above' : f > 0.78 ? 'below' : 'into'
  }
  const target = (z: Zone): DropTarget => z === 'into' ? { kind: 'into', chartId } : { kind: 'new', index: z === 'above' ? position : position + 1 }

  return (
    <div className="relative flex flex-col border-b border-[#242424] last:border-b-0" style={{ flex: 1, minHeight: 60 }}
      onDragOver={e => { if (!isOurDrag(e)) return; e.preventDefault(); setZone(zoneOf(e)) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null) }}
      onDrop={e => { const z = zoneOf(e); setZone(null); onDragState(false); performDrop(e, target(z), dropChannel, dropTrace) }}>
      <div className="panel-drag flex items-center justify-between gap-2 px-2 border-b border-[#1c1c1c] bg-[#151515]" style={{ minHeight: 19, cursor: 'grab', touchAction: 'none' }}>
        <div className="flex items-center gap-2 flex-wrap" style={{ minWidth: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 8, color: '#555', letterSpacing: '0.15em', flexShrink: 0 }} title="Drag the title bar to reorder charts">{chart.title}</span>
          {traces.map(({ trace, index, def, get }) => {
            const frame = inspection.frame
            const value = frame ? get(frame) : NaN
            let valueColor = trace.color
            if (trace.dangerAt != null && value >= trace.dangerAt) valueColor = '#ff3333'
            else if (trace.warnAt != null && value >= trace.warnAt) valueColor = '#ff8800'
            const dim = trace.hidden || (highlighted !== null && highlighted !== index)
            return (
              <span key={index} className="flex items-center gap-1" style={{ opacity: trace.hidden ? 0.35 : dim ? 0.55 : 1 }}>
                <button title={trace.hidden ? 'Show trace' : 'Hide trace'} onClick={() => onToggleHidden(index)}
                  style={{ width: 8, height: 8, borderRadius: 2, padding: 0, cursor: 'pointer', backgroundColor: trace.hidden ? 'transparent' : trace.color, border: `1px solid ${trace.color}` }} />
                <span draggable title={def.description ?? 'Click to highlight · drag to another chart to regroup, or to a chart edge to split it out'}
                  onDragStart={e => { e.dataTransfer.setData(TRACE_MIME, JSON.stringify({ chartId, index })); e.dataTransfer.effectAllowed = 'move'; onDragState(true) }}
                  onDragEnd={() => onDragState(false)}
                  onClick={() => setHighlight(h => (h === index ? null : index))}
                  style={{ fontFamily: MONO, fontSize: 8, cursor: 'pointer', color: trace.color, letterSpacing: '0.08em', textDecoration: highlighted === index ? 'underline' : 'none', fontWeight: highlighted === index ? 700 : 400 }}>
                  {def.label}
                </span>
                <LegendWarnings channel={trace.channel} />
                <span style={{ fontFamily: MONO, fontSize: highlighted === index ? 11 : 9, color: Number.isFinite(value) ? valueColor : '#444', fontWeight: 700 }}>
                  {fmtNum(value, 1)}<span style={{ color: '#3a3a3a', fontSize: 7, marginLeft: 1 }}>{Number.isFinite(value) ? def.unit : 'N/A'}</span>
                </span>
              </span>
            )
          })}
        </div>
        <div className="flex items-center gap-1.5">
          {zoomedY && <button onClick={() => setYWin(FULL_Y)} style={btn(true, '#ffaa00')} title="Reset vertical scale">Y×{(1 / (yWin.hi - yWin.lo)).toFixed(1)} ⟲</button>}
          <WidgetControls onConfig={onConfig} />
        </div>
      </div>
      <div ref={bodyRef} data-chart-body className="relative flex-1 overflow-hidden bg-[#191919]">
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {axis && scaleTicks(axis.lo, axis.hi).map(v => {
            const y = axis.toY(v)
            return (
              <g key={v}>
                <line x1={0} y1={y} x2={W} y2={y} stroke="#202020" strokeWidth="0.5" />
                <text x={4} y={clamp(y - 2, 7, H - 2)} fontSize="6.5" fill={axis.trace.color} opacity="0.5" fontFamily="monospace">{v}</text>
              </g>
            )
          })}
          {axis && [axis.trace.warnAt, axis.trace.dangerAt].map((level, i) => level == null ? null : (
            <line key={i} x1={0} x2={W} y1={axis.toY(level)} y2={axis.toY(level)} stroke={i === 0 ? '#ff8800' : '#ff3333'} strokeWidth="0.6" strokeDasharray="6 4" opacity="0.5" />
          ))}
          {visible.map(({ trace, index, get, toY }) => {
            const isHi = highlighted === index
            const faded = highlighted !== null && !isHi
            return clipped.map((series, si) => {
              const d = tracePath(series.frames, get, series.offset, range.xMin, range.xMax, W, toY)
              if (!d) return null
              const ghost = series.role !== 'primary'
              return (
                <path key={`${index}-${si}`} d={d} fill="none" stroke={trace.color}
                  strokeWidth={ghost ? 0.9 : isHi ? 2 : 1.3}
                  strokeDasharray={ghost ? (series.role === 'best' ? '5 3' : '1.5 2.5') : undefined}
                  opacity={ghost ? (faded ? 0.12 : 0.4) : faded ? 0.22 : 1}
                  filter={isHi && !ghost ? `url(#${glowId})` : undefined} vectorEffect="non-scaling-stroke" />
              )
            })
          })}
          {crossFrac !== null && <line x1={clamp(crossFrac, 0, 1) * W} y1={0} x2={clamp(crossFrac, 0, 1) * W} y2={H} stroke="#ffffff" strokeWidth="0.6" opacity="0.25" strokeDasharray="4 4" />}
        </svg>
        {/* Scale strip: drag to pan the vertical scale, double-click to reset (Option/Alt + wheel zooms it). */}
        <div data-axis-strip title="Scale: drag to pan · Option/Alt + wheel to zoom · double-click to reset"
          className="absolute left-0 top-0 bottom-0 hover:bg-[#ffffff08]" style={{ width: 26, cursor: 'ns-resize' }}
          onPointerDown={e => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); axisDrag.current = { y: e.clientY, win: yWin } }}
          onPointerMove={e => {
            const d = axisDrag.current
            const h = bodyRef.current?.getBoundingClientRect().height
            if (!d || !h) return
            setYWin(panY(d.win, ((e.clientY - d.y) / h) * (d.win.hi - d.win.lo)))
          }}
          onPointerUp={() => { axisDrag.current = null }}
          onDoubleClick={e => { e.stopPropagation(); setYWin(FULL_Y) }} />
        {visible.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ fontFamily: MONO, fontSize: 8, color: '#333', letterSpacing: '0.2em' }}>
            {chart.traces.length === 0 ? 'EMPTY — DRAG A CHANNEL HERE' : 'ALL TRACES HIDDEN'}
          </div>
        )}
      </div>
      {/* Drop feedback */}
      {dragging && zone === 'into' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ backgroundColor: '#4488ff14', border: '1px solid #4488ff88' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: '#4488ff', letterSpacing: '0.2em', backgroundColor: '#0f0f0fcc', padding: '3px 8px', borderRadius: 3 }}>OVERLAY IN {chart.title}</span>
        </div>
      )}
      {dragging && (zone === 'above' || zone === 'below') && (
        <div className="absolute left-0 right-0 pointer-events-none flex justify-center" style={{ [zone === 'above' ? 'top' : 'bottom']: 0, height: 3, backgroundColor: '#00ff41' }}>
          <span style={{ position: 'absolute', [zone === 'above' ? 'top' : 'bottom']: 4, fontFamily: MONO, fontSize: 8, color: '#00ff41', backgroundColor: '#0f0f0fdd', padding: '2px 6px', borderRadius: 3, letterSpacing: '0.15em' }}>NEW CHART {zone === 'above' ? 'ABOVE' : 'BELOW'}</span>
        </div>
      )}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────
type Zoom = { kind: 'live'; span: number } | { kind: 'fixed'; xMin: number; xMax: number } | null

export function TimeSeriesPanel({ telemetry, syncCrosshair, onInspectionChange }: { telemetry: Telemetry; syncCrosshair: boolean; onInspectionChange?: (inspection: ChartInspection) => void }) {
  const cfg = useConfig()
  const { chartOrder, chartCfg, math, openConfig, setChartOrder, timeRange, setTimeRange, updateTrace, dropChannel, dropTrace } = cfg
  const { history } = telemetry
  const [crossFrac, setCrossFrac] = useState<number | null>(null)
  const [customWindow, setCustomWindow] = useState('')
  const [showChannels, setShowChannels] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [footerHot, setFooterHot] = useState(false)
  const [band, setBand] = useState<{ a: number; b: number } | null>(null)
  const chartsRef = useRef<HTMLDivElement>(null)
  const lapMarks = useLapMarks(telemetry.streamKey)

  // history is appended in place; its length/endpoints identify the content.
  const histLen = history.length
  const histFirst = history[0]?.t
  const histLast = history[histLen - 1]?.t
  const frameLaps = useMemo(() => lapsFromFrames(history), [history, histLen, histFirst, histLast])
  const manual = frameLaps.length === 0
  const laps: LapSpan[] = manual ? lapsFromMarks(lapMarks.marks) : frameLaps
  const view = useMemo(() => buildView(history, timeRange, laps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, histLen, histFirst, histLast, timeRange, laps.length, laps[laps.length - 1]?.start, laps[laps.length - 1]?.end])

  // ── Time zoom (shared by all charts) ──
  const zoomKey = `${timeRange.mode}|${timeRange.windowS}|${timeRange.lap}|${telemetry.streamKey}`
  const [zoomState, setZoomState] = useState<{ key: string; zoom: Zoom }>({ key: zoomKey, zoom: null })
  const zoom = zoomState.key === zoomKey ? zoomState.zoom : null
  const setZoom = (z: Zoom) => setZoomState({ key: zoomKey, zoom: z })
  const followable = timeRange.mode !== 'lap'
  const bounds = viewBounds(view)
  const range: XRange = !zoom ? { xMin: view.xMin, xMax: view.xMax }
    : zoom.kind === 'live' ? { xMin: bounds.xMax - zoom.span, xMax: bounds.xMax }
    : zoom
  const span = range.xMax - range.xMin
  const inspection = inspectChart(view, range, crossFrac)
  useEffect(() => {
    onInspectionChange?.({ frame: inspection.frame, label: inspection.label, mode: inspection.mode })
  }, [onInspectionChange, inspection.frame, inspection.label, inspection.mode])

  /** After a zoom/pan, keep following live data if the view touches the newest sample. */
  const commit = (r: XRange) => {
    const atLiveEdge = followable && r.xMax >= bounds.xMax - Math.max(0.05, (r.xMax - r.xMin) * 0.01)
    setZoom(atLiveEdge ? { kind: 'live', span: r.xMax - r.xMin } : { kind: 'fixed', ...r })
  }
  const zoomBy = (factor: number, anchorFrac: number) => commit(zoomRange(range, anchorFrac, factor, bounds, MIN_SPAN_S))
  const panBy = (fracOfSpan: number) => commit(panRange(range, fracOfSpan * span, bounds))

  const rangeRef = useRef({ zoomBy, panBy })
  rangeRef.current = { zoomBy, panBy }

  // Wheel: zoom time around the cursor; Shift/horizontal wheel pans. (Alt+wheel is the chart's vertical zoom.)
  useEffect(() => {
    const el = chartsRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.altKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const frac = (e.clientX - r.left) / r.width
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX
        rangeRef.current.panBy(d / r.width)
      } else {
        rangeRef.current.zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), frac) // ctrl = trackpad pinch
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Drag on a chart body: select a span to zoom to; Shift-drag or middle-drag pans.
  const dragRef = useRef<{ mode: 'band' | 'pan'; startX: number; startFrac: number; range: XRange } | null>(null)
  const fracAt = (clientX: number) => {
    const r = chartsRef.current?.getBoundingClientRect()
    return r ? clamp((clientX - r.left) / r.width, 0, 1) : 0
  }
  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement
    if (!t.closest('[data-chart-body]') || t.closest('[data-axis-strip]')) return
    if (e.button !== 0 && e.button !== 1) return
    const pan = e.shiftKey || e.button === 1
    dragRef.current = { mode: pan ? 'pan' : 'band', startX: e.clientX, startFrac: fracAt(e.clientX), range }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (!pan) setBand({ a: dragRef.current.startFrac, b: dragRef.current.startFrac })
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const frac = fracAt(e.clientX)
    if (syncCrosshair) setCrossFrac(frac)
    const d = dragRef.current
    if (!d) return
    if (d.mode === 'band') setBand({ a: d.startFrac, b: frac })
    else {
      const w = chartsRef.current?.getBoundingClientRect().width ?? 1
      const s = d.range.xMax - d.range.xMin
      commit(panRange(d.range, -((e.clientX - d.startX) / w) * s, bounds))
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    setBand(null)
    if (!d || d.mode !== 'band') return
    const a = d.startFrac, b = fracAt(e.clientX)
    if (Math.abs(b - a) < 0.01) return
    const s = d.range.xMax - d.range.xMin
    const lo = d.range.xMin + Math.min(a, b) * s
    const hi = d.range.xMin + Math.max(a, b) * s
    commit(hi - lo < MIN_SPAN_S ? { xMin: (lo + hi - MIN_SPAN_S) / 2, xMax: (lo + hi + MIN_SPAN_S) / 2 } : { xMin: lo, xMax: hi })
  }

  // ── Lap marks ──
  const markLap = () => {
    const t = telemetry.sessionTimeNow()
    if (t !== null) lapMarks.addMark(t)
  }

  // Keyboard: L = mark lap (manual laps), +/- = zoom time, 0 = reset zoom.
  const keyRef = useRef({ markLap, manual, zoomBy, reset: () => setZoom(null) })
  keyRef.current = { markLap, manual, zoomBy, reset: () => setZoom(null) }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      const k = keyRef.current
      if ((e.key === 'l' || e.key === 'L') && k.manual) { e.preventDefault(); k.markLap() }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); k.zoomBy(0.7, 0.5) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); k.zoomBy(1 / 0.7, 0.5) }
      else if (e.key === '0') { e.preventDefault(); k.reset() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const newest = histLen ? history[histLen - 1].t : NaN
  const best = bestLap(laps)
  const setMode = (mode: RangeMode) => setTimeRange({ mode })
  const charted = new Set(chartOrder.flatMap(id => chartCfg[id]?.traces.map(t => t.channel) ?? []))
  const orderedIds = chartOrder.filter(id => chartCfg[id])

  const items: StackItem[] = orderedIds.map((id, position) => ({
    id, title: chartCfg[id].title, weight: 1,
    node: (
      <GroupChart chartId={id} position={position} chart={chartCfg[id]} view={view} range={range} crossFrac={crossFrac} math={math}
        dragging={dragging} onDragState={setDragging}
        onConfig={() => openConfig({ kind: 'chart', id })}
        onToggleHidden={index => updateTrace(id, index, { hidden: !chartCfg[id].traces[index].hidden })} />
    ),
  }))

  const crossTime = crossFrac !== null ? range.xMin + clamp(crossFrac, 0, 1) * span : null
  const axisLabel = (x: number) => {
    if (timeRange.mode === 'window') return x >= newest - 0.05 ? 'NOW' : `-${fmtDuration(newest - x)}`
    return fmtDuration(timeRange.mode === 'session' ? x - bounds.xMin : x)
  }
  const zoomed = zoom !== null
  const paused = zoom?.kind === 'fixed' && followable

  return (
    <div className="flex h-full">
      {showChannels
        ? <ChannelList onClose={() => setShowChannels(false)} charted={charted} onDragState={setDragging} />
        : (
          <button onClick={() => setShowChannels(true)} title="Show channel list"
            className="flex items-center justify-center border-r border-[#242424] bg-[#111]" style={{ width: 14, cursor: 'pointer' }}>
            <span style={{ fontFamily: MONO, fontSize: 7, writingMode: 'vertical-lr', letterSpacing: '0.2em', color: '#3a3a3a' }}>› CHANNELS</span>
          </button>
        )}

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Range + zoom controls */}
        <div className="flex items-center gap-2 px-2 border-b border-[#242424] bg-[#111111] flex-wrap" style={{ minHeight: 22, paddingTop: 2, paddingBottom: 2 }}>
          <div className="flex items-center gap-1">
            <button style={btn(timeRange.mode === 'window')} onClick={() => setMode('window')} title="Fixed time window, following live data">WINDOW</button>
            <button style={btn(timeRange.mode === 'session')} onClick={() => setMode('session')} title="Whole session since the car started sending">SESSION</button>
            <button style={btn(timeRange.mode === 'lap')} onClick={() => setMode('lap')} title="Lap time on the x-axis">LAP</button>
          </div>

          {timeRange.mode === 'window' && (
            <div className="flex items-center gap-1">
              {WINDOW_PRESETS_S.map(s => (
                <button key={s} style={btn(timeRange.windowS === s, '#00ccff')} onClick={() => setTimeRange({ windowS: s })}>{s < 60 ? `${s}s` : `${s / 60}m`}</button>
              ))}
              <input value={customWindow} placeholder="sec" style={{ ...inputStyle, width: 38 }}
                onChange={e => setCustomWindow(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  const n = Number(customWindow)
                  if (Number.isFinite(n) && n >= 1) setTimeRange({ windowS: Math.min(n, 7200) })
                }}
                title="Custom window in seconds (Enter to apply)" />
            </div>
          )}

          {timeRange.mode === 'lap' && (
            <div className="flex items-center gap-1 flex-wrap">
              <select value={String(timeRange.lap)} style={inputStyle}
                onChange={e => setTimeRange({ lap: e.target.value === 'current' ? 'current' : Number(e.target.value) })}>
                <option value="current">CURRENT LAP</option>
                {[...laps].reverse().map(l => (
                  <option key={l.num} value={l.num}>
                    LAP {l.num} · {fmtDuration(lapLength(l, newest))}{l.end === null ? ' (in progress)' : best?.num === l.num ? ' ★ best' : ''}
                  </option>
                ))}
              </select>
              <button style={btn(timeRange.ghostBest, '#c88bff')} onClick={() => setTimeRange({ ghostBest: !timeRange.ghostBest })} title="Overlay the fastest completed lap (dashed)">GHOST BEST</button>
              <button style={btn(timeRange.ghostPrev, '#c88bff')} onClick={() => setTimeRange({ ghostPrev: !timeRange.ghostPrev })} title="Overlay the lap before the shown lap (dotted)">GHOST PREV</button>
            </div>
          )}

          {manual && (
            <div className="flex items-center gap-1">
              <button style={btn(true, '#00ff41')} onClick={markLap} title="Mark the start/finish line crossing now (shortcut: L)">MARK LAP (L)</button>
              {lapMarks.marks.length > 0 && <button style={btn(false)} onClick={lapMarks.undoLast} title="Remove the most recent lap mark">UNDO</button>}
            </div>
          )}

          <span className="flex-1" />
          <div className="flex items-center gap-1">
            <button style={btn(false)} onClick={() => zoomBy(1 / 0.7, 0.5)} title="Zoom out (−, or scroll)">−</button>
            <button style={btn(false)} onClick={() => zoomBy(0.7, 0.5)} title="Zoom in (+, scroll, or drag across a chart)">+</button>
            {zoomed && <button style={btn(true, '#ffaa00')} onClick={() => setZoom(null)} title="Reset zoom (0, or double-click a chart)">FIT</button>}
            {paused && <button style={btn(true, '#00ff41')} onClick={() => commit({ xMin: bounds.xMax - span, xMax: bounds.xMax })} title="Jump to the newest data and follow it">● LIVE</button>}
          </div>
          <span style={{ fontFamily: MONO, fontSize: 8, color: '#3a3a3a', letterSpacing: '0.15em' }}>
            {zoomed ? `ZOOM ${fmtDuration(span)}${paused ? ' · PAUSED' : ''}` : view.caption}
            {crossTime !== null && histLen ? ` · @ ${axisLabel(crossTime)}` : ''}
            {telemetry.historyTruncated && timeRange.mode === 'session' ? ' · OLDEST DATA TRIMMED' : ''}
          </span>
          <button style={btn(false, '#00ff41')} onClick={() => openConfig({ kind: 'chart', id: cfg.addChart() })} title="Add an empty chart (or drag a channel to a chart edge)">+ CHART</button>
        </div>

        {/* Charts */}
        <div ref={chartsRef} className="relative flex flex-col flex-1 overflow-hidden"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerLeave={() => { if (!dragRef.current) setCrossFrac(null) }}
          onDoubleClick={e => { if ((e.target as HTMLElement).closest('[data-chart-body]')) setZoom(null) }}>
          {items.length > 0
            ? <DraggableStack items={items} onReorder={setChartOrder} />
            : (
              <div className="flex flex-1 items-center justify-center" style={{ fontFamily: MONO, fontSize: 9, color: '#444' }}
                onDragOver={e => { if (isOurDrag(e)) e.preventDefault() }}
                onDrop={e => { setDragging(false); performDrop(e, { kind: 'new', index: 0 }, dropChannel, dropTrace) }}>
                NO CHARTS — DRAG A CHANNEL HERE
              </div>
            )}
          {band && (
            <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${Math.min(band.a, band.b) * 100}%`, width: `${Math.abs(band.b - band.a) * 100}%`, backgroundColor: '#4488ff22', borderLeft: '1px solid #4488ff', borderRight: '1px solid #4488ff' }} />
          )}
          {view.emptyReason && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span style={{ fontFamily: MONO, fontSize: 9, color: '#666', backgroundColor: '#111111dd', padding: '6px 10px', borderRadius: 4, letterSpacing: '0.15em' }}>{view.emptyReason}</span>
            </div>
          )}
        </div>

        {/* New-chart drop zone (visible while dragging a channel or trace) */}
        {dragging && items.length > 0 && (
          <div className="flex items-center justify-center" style={{ height: 22, border: `1px dashed ${footerHot ? '#00ff41' : '#2e2e2e'}`, backgroundColor: footerHot ? '#00ff4112' : '#141414' }}
            onDragOver={e => { if (!isOurDrag(e)) return; e.preventDefault(); setFooterHot(true) }}
            onDragLeave={() => setFooterHot(false)}
            onDrop={e => { setFooterHot(false); setDragging(false); performDrop(e, { kind: 'new', index: orderedIds.length }, dropChannel, dropTrace) }}>
            <span style={{ fontFamily: MONO, fontSize: 8, color: footerHot ? '#00ff41' : '#444', letterSpacing: '0.2em' }}>DROP HERE FOR A NEW CHART AT THE BOTTOM</span>
          </div>
        )}

        {/* X axis */}
        <div className="flex items-center justify-between px-2 border-t border-[#1c1c1c] bg-[#111111]" style={{ height: 14 }}>
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <span key={p} style={{ fontFamily: MONO, fontSize: 7, color: '#333' }}>{histLen ? axisLabel(range.xMin + p * span) : ''}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
