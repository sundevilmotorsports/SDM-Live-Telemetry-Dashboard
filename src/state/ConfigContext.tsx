import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { CHART_BASE, CHART_BASE_MAP, CHANNEL_MAP } from '../telemetry/simulation'
import { DEFAULT_TIME_RANGE, type TimeRangeConfig } from '../telemetry/chartView'

// ── Config types ─────────────────────────────────────────────────────────────
/** One channel drawn in a chart, on its own scale. */
export interface TraceConfig {
  channel: string
  color: string
  min: number
  max: number
  warnAt: number | null
  dangerAt: number | null
  hidden: boolean
}

/** A chart is a group of overlaid traces. */
export interface ChartConfig {
  title: string
  traces: TraceConfig[]
}

export type { TimeRangeConfig }

/** Where a dragged channel/trace lands: overlaid into a chart, or as a new chart at a position in chartOrder. */
export type DropTarget = { kind: 'into'; chartId: string } | { kind: 'new'; index: number }

export type TelemetrySource = 'simulation' | 'websocket' | 'supabase'
export type SupabaseMode = 'raw' | 'broadcast'

export const DEFAULT_STALE_MS = 3500

function envString(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key]
  return typeof value === 'string' ? value : ''
}

function envStaleMs(): number {
  const n = Number(envString('VITE_TELEMETRY_STALE_MS'))
  return Number.isFinite(n) && n >= 500 ? n : DEFAULT_STALE_MS
}

export type ConfigTarget =
  | { kind: 'chart'; id: string }
  | { kind: 'gauges' }
  | { kind: 'suspension' }
  | { kind: 'pedal' }
  | { kind: 'gforce' }
  | { kind: 'gps' }
  | { kind: 'source' }
  | { kind: 'all' }

export type GaugeStyle = 'dial' | 'vbar' | 'hbar'
export const GAUGE_STYLES: { id: GaugeStyle; label: string; title: string }[] = [
  { id: 'dial', label: 'DIAL', title: 'Round dial with needle' },
  { id: 'vbar', label: 'BAR ↕', title: 'Vertical segmented bar' },
  { id: 'hbar', label: 'BAR ↔', title: 'Horizontal segmented bar' },
]

export interface GaugeConfig {
  id: string
  channel: string       // channel id (or math:<id>)
  style: GaugeStyle
  min: number
  max: number
  warnAt: number | null
  dangerAt: number | null
}

export interface AlertRule {
  id: string
  expr: string
  severity: 'warn' | 'danger'
  message: string
  enabled: boolean
}

export interface MathChannel {
  id: string
  name: string
  unit: string
  expr: string
}

export interface LayoutFlags {
  suspension: boolean
  timing: boolean
  gps: boolean
  syncCrosshair: boolean
}

export interface ConfigState {
  gauges: GaugeConfig[]
  alerts: AlertRule[]
  math: MathChannel[]
  layout: LayoutFlags
  widgetOrder: string[]
  chartOrder: string[]
  chartCfg: Record<string, ChartConfig>
  timeRange: TimeRangeConfig
  telemetrySource: TelemetrySource
  wsUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
  telemetrySessionId: string
  telemetryDeviceId: string
  supabaseMode: SupabaseMode
  staleAfterMs: number
}

const TRACE_PALETTE = ['#00ff41', '#ff3333', '#ffff00', '#00ffff', '#4488ff', '#c88bff', '#ff8800', '#33ff99', '#ff6644', '#00ffaa']

/** A trace for a channel with its registry scale; math channels default to 0-100. */
export function makeTrace(channel: string, color?: string): TraceConfig {
  const def = channel.startsWith('math:') ? undefined : CHANNEL_MAP[channel]
  return {
    channel, color: color ?? def?.color ?? TRACE_PALETTE[0],
    min: def?.min ?? 0, max: def?.max ?? 100, warnAt: null, dangerAt: null, hidden: false,
  }
}

export function nextTraceColor(traces: TraceConfig[]): string {
  const used = new Set(traces.map(t => t.color.toLowerCase()))
  return TRACE_PALETTE.find(c => !used.has(c)) ?? TRACE_PALETTE[traces.length % TRACE_PALETTE.length]
}

const DEFAULT_CHART_CFG: Record<string, ChartConfig> = Object.fromEntries(
  CHART_BASE.map(c => [c.id, {
    title: c.label,
    traces: [
      { ...makeTrace(c.channel, c.color), min: c.min, max: c.max },
      ...(c.extra ?? []).map(e => ({ ...makeTrace(e.channel, e.color), min: c.min, max: c.max })),
    ],
  }]),
)

const finiteOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const nullableNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function normalizeTrace(raw: unknown): TraceConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  if (typeof t.channel !== 'string' || !t.channel) return null
  const base = makeTrace(t.channel, typeof t.color === 'string' ? t.color : undefined)
  return {
    ...base,
    min: finiteOr(t.min, base.min), max: finiteOr(t.max, base.max),
    warnAt: nullableNum(t.warnAt), dangerAt: nullableNum(t.dangerAt), hidden: t.hidden === true,
  }
}

/**
 * Accepts saved chart configs from any version. Pre-grouping configs stored one
 * channel per chart ({ channel, color, min, max, ... }); those become a chart
 * with that trace, plus the built-in companion traces (e.g. the other wheels).
 */
export function normalizeCharts(order: unknown, cfg: unknown): { chartOrder: string[]; chartCfg: Record<string, ChartConfig> } {
  const savedCfg = cfg && typeof cfg === 'object' ? cfg as Record<string, unknown> : {}
  const ids = Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string') : DEFAULT.chartOrder
  const chartCfg: Record<string, ChartConfig> = {}
  for (const id of ids) {
    const saved = savedCfg[id] as Record<string, unknown> | undefined
    const fallback = DEFAULT_CHART_CFG[id]
    let chart: ChartConfig | null = null
    if (saved && Array.isArray(saved.traces)) {
      const traces = saved.traces.map(normalizeTrace).filter((t): t is TraceConfig => t !== null)
      chart = { title: typeof saved.title === 'string' ? saved.title : fallback?.title ?? 'CHART', traces }
    } else if (saved && typeof saved.channel === 'string') {
      const base = CHART_BASE_MAP[id]
      const main = normalizeTrace(saved)
      const extras = (base?.extra ?? []).map(e => ({ ...makeTrace(e.channel, e.color), min: main?.min ?? base!.min, max: main?.max ?? base!.max }))
      chart = { title: base?.label ?? CHANNEL_MAP[saved.channel]?.label.toUpperCase() ?? 'CHART', traces: [...(main ? [main] : []), ...extras] }
    } else if (fallback) {
      chart = structuredClone(fallback)
    }
    if (chart) chartCfg[id] = chart
  }
  return { chartOrder: ids.filter(id => chartCfg[id]), chartCfg }
}

/** Saved gauges from older versions have no style; they were all dials. */
export function normalizeGauges(raw: unknown): GaugeConfig[] {
  if (!Array.isArray(raw)) return DEFAULT.gauges
  const out: GaugeConfig[] = []
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return
    const g = item as Record<string, unknown>
    if (typeof g.channel !== 'string' || !g.channel) return
    const base = makeTrace(g.channel)
    out.push({
      id: typeof g.id === 'string' && g.id ? g.id : `g${i}`,
      channel: g.channel,
      style: g.style === 'vbar' || g.style === 'hbar' || g.style === 'dial' ? g.style : 'dial',
      min: finiteOr(g.min, base.min), max: finiteOr(g.max, base.max),
      warnAt: nullableNum(g.warnAt), dangerAt: nullableNum(g.dangerAt),
    })
  })
  return out.length ? out : DEFAULT.gauges
}

function normalizeTimeRange(raw: unknown): TimeRangeConfig {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    mode: r.mode === 'session' || r.mode === 'lap' || r.mode === 'window' ? r.mode : DEFAULT_TIME_RANGE.mode,
    windowS: finiteOr(r.windowS, DEFAULT_TIME_RANGE.windowS) > 0 ? finiteOr(r.windowS, DEFAULT_TIME_RANGE.windowS) : DEFAULT_TIME_RANGE.windowS,
    lap: r.lap === 'current' || (typeof r.lap === 'number' && Number.isInteger(r.lap)) ? r.lap as 'current' | number : 'current',
    ghostBest: typeof r.ghostBest === 'boolean' ? r.ghostBest : DEFAULT_TIME_RANGE.ghostBest,
    ghostPrev: typeof r.ghostPrev === 'boolean' ? r.ghostPrev : DEFAULT_TIME_RANGE.ghostPrev,
  }
}

const DEFAULT: ConfigState = {
  gauges: [
    { id: 'g1', channel: 'speed', style: 'dial', min: 0, max: 240, warnAt: null, dangerAt: null },
    { id: 'g2', channel: 'rpm', style: 'dial', min: 0, max: 8000, warnAt: 6800, dangerAt: 7400 },
  ],
  alerts: [
    { id: 'a1', expr: 'coolant > 99', severity: 'danger', message: 'COOLANT TEMP CRITICAL', enabled: true },
    { id: 'a2', expr: 'oilPress < 2', severity: 'danger', message: 'LOW OIL PRESSURE', enabled: true },
    { id: 'a3', expr: 'rpm > 7400', severity: 'warn', message: 'RPM OVER LIMIT', enabled: true },
    { id: 'a4', expr: 'volt < 11.5', severity: 'warn', message: 'BATTERY LOW', enabled: true },
  ],
  math: [
    { id: 'm1', name: 'Avg Wheel Spd', unit: 'km/h', expr: '(wFL + wFR + wRL + wRR) / 4' },
    { id: 'm2', name: 'Total G', unit: 'G', expr: 'sqrt(gX*gX + gY*gY)' },
  ],
  layout: { suspension: true, timing: true, gps: true, syncCrosshair: true },
  widgetOrder: ['gauges', 'suspension', 'bottom'],
  chartOrder: CHART_BASE.map(c => c.id),
  chartCfg: DEFAULT_CHART_CFG,
  timeRange: DEFAULT_TIME_RANGE,
  telemetrySource: 'simulation',
  wsUrl: 'ws://localhost:8765',
  supabaseUrl: envString('VITE_SUPABASE_URL'),
  supabaseAnonKey: envString('VITE_SUPABASE_ANON_KEY'),
  telemetrySessionId: envString('VITE_TELEMETRY_SESSION_ID'),
  telemetryDeviceId: envString('VITE_TELEMETRY_DEVICE_ID'),
  supabaseMode: 'raw',
  staleAfterMs: envStaleMs(),
}

interface Ctx extends ConfigState {
  setGauges: (g: GaugeConfig[]) => void
  setAlerts: (a: AlertRule[]) => void
  setMath: (m: MathChannel[]) => void
  setLayout: (l: LayoutFlags) => void
  setWidgetOrder: (o: string[]) => void
  setChartOrder: (o: string[]) => void
  updateChart: (id: string, patch: Partial<ChartConfig>) => void
  updateTrace: (chartId: string, index: number, patch: Partial<TraceConfig>) => void
  addTrace: (chartId: string, channel: string) => void
  removeTrace: (chartId: string, index: number) => void
  moveTrace: (chartId: string, index: number, delta: -1 | 1) => void
  /** Appends a new chart and returns its id. */
  addChart: () => string
  removeChart: (id: string) => void
  setTimeRange: (patch: Partial<TimeRangeConfig>) => void
  /** Drag a channel from the channel list onto a chart or between charts. */
  dropChannel: (channel: string, target: DropTarget) => void
  /** Drag an existing trace to another chart or out into its own chart. Empty charts are removed. */
  dropTrace: (fromChartId: string, index: number, target: DropTarget) => void
  setTelemetrySource: (source: TelemetrySource) => void
  setWsUrl: (url: string) => void
  setSupabaseUrl: (url: string) => void
  setSupabaseAnonKey: (key: string) => void
  setTelemetrySessionId: (id: string) => void
  setTelemetryDeviceId: (id: string) => void
  setSupabaseMode: (mode: SupabaseMode) => void
  setStaleAfterMs: (ms: number) => void
  reset: () => void
  // contextual config modal control
  configTarget: ConfigTarget | null
  openConfig: (target: ConfigTarget) => void
  closeConfig: () => void
}

function chartTitleFor(channel: string, math: MathChannel[]): string {
  if (channel.startsWith('math:')) return (math.find(m => `math:${m.id}` === channel)?.name ?? 'MATH').toUpperCase()
  return (CHANNEL_MAP[channel]?.label ?? channel).toUpperCase()
}

/** Pure state transition for drag-and-drop grouping (exported for tests). */
export function applyDrop(
  s: ConfigState,
  channel: string,
  from: { chartId: string; index: number; trace: TraceConfig } | null,
  target: DropTarget,
): ConfigState {
  if (from && target.kind === 'into' && target.chartId === from.chartId) return s
  if (target.kind === 'into' && !s.chartCfg[target.chartId]) return s
  const chartCfg = { ...s.chartCfg }
  let chartOrder = [...s.chartOrder]
  let insertAt = target.kind === 'new' ? Math.max(0, Math.min(target.index, chartOrder.length)) : -1

  if (from) {
    const src = chartCfg[from.chartId]
    const remaining = src.traces.filter((_, i) => i !== from.index)
    if (remaining.length === 0) {
      // An empty group disappears (as in MoTeC); keep the insertion point stable.
      const srcPos = chartOrder.indexOf(from.chartId)
      delete chartCfg[from.chartId]
      chartOrder = chartOrder.filter(id => id !== from.chartId)
      if (insertAt > srcPos) insertAt--
    } else {
      chartCfg[from.chartId] = { ...src, traces: remaining }
    }
  }

  if (target.kind === 'into') {
    const dst = chartCfg[target.chartId]
    if (!from && dst.traces.some(t => t.channel === channel)) return s // already overlaid there
    const trace = from ? from.trace : makeTrace(channel, nextTraceColor(dst.traces))
    chartCfg[target.chartId] = { ...dst, traces: [...dst.traces, trace] }
  } else {
    const id = `chart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    chartCfg[id] = { title: chartTitleFor(channel, s.math), traces: [from ? from.trace : makeTrace(channel)] }
    chartOrder.splice(insertAt, 0, id)
  }
  return { ...s, chartCfg, chartOrder: chartOrder.filter(id => chartCfg[id]) }
}

function withTraces(s: ConfigState, chartId: string, f: (traces: TraceConfig[]) => TraceConfig[]): ConfigState {
  const chart = s.chartCfg[chartId]
  return chart ? { ...s, chartCfg: { ...s.chartCfg, [chartId]: { ...chart, traces: f(chart.traces) } } } : s
}

const ConfigCtx = createContext<Ctx | null>(null)
const KEY = 'motec-dash-config-v1'

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfigState>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<ConfigState>
        const merged = { ...DEFAULT, ...saved }
        // Blank saved fields fall back to env so a restart picks up VITE_* values.
        // A non-empty saved value is a UI override and wins.
        if (!saved.supabaseUrl) merged.supabaseUrl = DEFAULT.supabaseUrl
        if (!saved.supabaseAnonKey) merged.supabaseAnonKey = DEFAULT.supabaseAnonKey
        if (!saved.telemetrySessionId) merged.telemetrySessionId = DEFAULT.telemetrySessionId
        if (!saved.telemetryDeviceId) merged.telemetryDeviceId = DEFAULT.telemetryDeviceId
        if (saved.supabaseMode !== 'raw' && saved.supabaseMode !== 'broadcast') merged.supabaseMode = DEFAULT.supabaseMode
        if (!saved.staleAfterMs) merged.staleAfterMs = DEFAULT.staleAfterMs
        Object.assign(merged, normalizeCharts(saved.chartOrder ?? DEFAULT.chartOrder, saved.chartCfg ?? DEFAULT.chartCfg))
        merged.timeRange = normalizeTimeRange(saved.timeRange)
        merged.gauges = normalizeGauges(saved.gauges)
        return merged
      }
    } catch { /* ignore */ }
    return DEFAULT
  })
  const [configTarget, setConfigTarget] = useState<ConfigTarget | null>(null)

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  }, [state])

  const value: Ctx = {
    ...state,
    setGauges: gauges => setState(s => ({ ...s, gauges })),
    setAlerts: alerts => setState(s => ({ ...s, alerts })),
    setMath: math => setState(s => ({ ...s, math })),
    setLayout: layout => setState(s => ({ ...s, layout })),
    setWidgetOrder: widgetOrder => setState(s => ({ ...s, widgetOrder })),
    setChartOrder: chartOrder => setState(s => ({ ...s, chartOrder })),
    updateChart: (id, patch) => setState(s => (s.chartCfg[id] ? { ...s, chartCfg: { ...s.chartCfg, [id]: { ...s.chartCfg[id], ...patch } } } : s)),
    updateTrace: (chartId, index, patch) => setState(s => withTraces(s, chartId, traces => traces.map((t, i) => (i === index ? { ...t, ...patch } : t)))),
    addTrace: (chartId, channel) => setState(s => withTraces(s, chartId, traces => [...traces, makeTrace(channel, nextTraceColor(traces))])),
    removeTrace: (chartId, index) => setState(s => withTraces(s, chartId, traces => traces.filter((_, i) => i !== index))),
    moveTrace: (chartId, index, delta) => setState(s => withTraces(s, chartId, traces => {
      const j = index + delta
      if (j < 0 || j >= traces.length) return traces
      const next = [...traces]
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })),
    addChart: () => {
      const id = `chart-${Date.now().toString(36)}`
      setState(s => ({
        ...s,
        chartOrder: [...s.chartOrder, id],
        chartCfg: { ...s.chartCfg, [id]: { title: 'NEW CHART', traces: [makeTrace('speed')] } },
      }))
      return id
    },
    removeChart: id => setState(s => {
      const chartCfg = { ...s.chartCfg }
      delete chartCfg[id]
      return { ...s, chartOrder: s.chartOrder.filter(c => c !== id), chartCfg }
    }),
    setTimeRange: patch => setState(s => ({ ...s, timeRange: { ...s.timeRange, ...patch } })),
    dropChannel: (channel, target) => setState(s => applyDrop(s, channel, null, target)),
    dropTrace: (fromChartId, index, target) => setState(s => {
      const trace = s.chartCfg[fromChartId]?.traces[index]
      return trace ? applyDrop(s, trace.channel, { chartId: fromChartId, index, trace }, target) : s
    }),
    setTelemetrySource: telemetrySource => setState(s => ({ ...s, telemetrySource })),
    setWsUrl: wsUrl => setState(s => ({ ...s, wsUrl })),
    setSupabaseUrl: supabaseUrl => setState(s => ({ ...s, supabaseUrl })),
    setSupabaseAnonKey: supabaseAnonKey => setState(s => ({ ...s, supabaseAnonKey })),
    setTelemetrySessionId: telemetrySessionId => setState(s => ({ ...s, telemetrySessionId })),
    setTelemetryDeviceId: telemetryDeviceId => setState(s => ({ ...s, telemetryDeviceId })),
    setSupabaseMode: supabaseMode => setState(s => ({ ...s, supabaseMode })),

    setStaleAfterMs: staleAfterMs => setState(s => ({ ...s, staleAfterMs })),
    reset: () => setState(s => ({
      ...s,
      gauges: DEFAULT.gauges,
      alerts: DEFAULT.alerts,
      math: DEFAULT.math,
      layout: DEFAULT.layout,
      widgetOrder: DEFAULT.widgetOrder,
      chartOrder: DEFAULT.chartOrder,
      chartCfg: DEFAULT.chartCfg,
      timeRange: DEFAULT.timeRange,
    })),
    configTarget,
    openConfig: target => setConfigTarget(target),
    closeConfig: () => setConfigTarget(null),
  }
  return <ConfigCtx.Provider value={value}>{children}</ConfigCtx.Provider>
}

export function useConfig() {
  const c = useContext(ConfigCtx)
  if (!c) throw new Error('useConfig must be used within ConfigProvider')
  return c
}
