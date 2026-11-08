import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { CHART_BASE, CHART_BASE_MAP, CHANNEL_MAP } from '../telemetry/simulation'
import { sanitizeUnitPrefs, type UnitPrefs } from '../telemetry/units'
import { LOGGER_CHANNEL_BY_NAME } from '../telemetry/raw/loggerChannels'
import { DEFAULT_AUTO_ZERO, DEFAULT_REST_CONDITION, DEFAULT_REST_HOLD_S, OLD_DEFAULT_REST_CONDITION } from '../telemetry/zeroing'
import { DEFAULT_TIME_RANGE, type TimeRangeConfig } from '../telemetry/chartView'
import {
  addProfile, deleteProfile, duplicateProfile, exportProfile, parseProfileImport, renameProfile,
  replaceActive, snapshotOf, switchProfile, syncActive, type Profile, type ProfileData,
} from './profiles'
import { PRESET_BY_ID, buildPresetData } from './profilePresets'
import { applySizePatch, sanitizePanelSizes, type PanelSizes } from './panelSizes'

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
  fuel: boolean
  steering: boolean
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
  wheelReferenceAdded?: boolean
  telemetrySource: TelemetrySource
  wsUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
  telemetrySessionId: string
  telemetryDeviceId: string
  supabaseMode: SupabaseMode
  staleAfterMs: number
  /** Display unit per channel key (dashboard channel id, math:<id>, or source id). Absent = base unit. */
  unitPrefs: UnitPrefs
  /** Channel keys re-zeroed when the car is at rest (see telemetry/zeroing.ts). */
  autoZero: string[]
  /** Expression over dashboard channels that means "car at rest", e.g. rpm < 500. */
  restCondition: string
  /** Seconds the rest condition must hold before a baseline is captured. */
  restHoldS: number
  /** Whole-screen layouts (see profiles.ts). The fields above/below this are the active profile's working copy. */
  profiles: Profile[]
  activeProfileId: string
  /** Dragged panel sizes of the active profile (see panelSizes.ts). */
  panelSizes: PanelSizes
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
      ...(c.id === 'wheels' ? [makeTrace('wheelRef')] : []),
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
  layout: { fuel: true, steering: true, suspension: true, timing: true, gps: true, syncCrosshair: true },
  widgetOrder: ['gauges', 'steering', 'suspension', 'bottom'],
  chartOrder: CHART_BASE.map(c => c.id),
  chartCfg: DEFAULT_CHART_CFG,
  timeRange: DEFAULT_TIME_RANGE,
  wheelReferenceAdded: true,
  telemetrySource: 'simulation',
  wsUrl: 'ws://localhost:8765',
  supabaseUrl: envString('VITE_SUPABASE_URL'),
  supabaseAnonKey: envString('VITE_SUPABASE_ANON_KEY'),
  telemetrySessionId: envString('VITE_TELEMETRY_SESSION_ID'),
  telemetryDeviceId: envString('VITE_TELEMETRY_DEVICE_ID'),
  supabaseMode: 'raw',
  staleAfterMs: envStaleMs(),
  unitPrefs: {},
  autoZero: DEFAULT_AUTO_ZERO,
  restCondition: DEFAULT_REST_CONDITION,
  restHoldS: DEFAULT_REST_HOLD_S,
  profiles: [],
  activeProfileId: '',
  panelSizes: {},
}

const WIDGET_IDS = ['gauges', 'steering', 'suspension', 'bottom']

/** Repairs a profile's layout the same way saved config is repaired (older/hand-edited/imported data). */
export function normalizeProfileData(raw: unknown): ProfileData {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const { chartOrder, chartCfg } = normalizeCharts(r.chartOrder ?? [], r.chartCfg ?? {})
  const order = Array.isArray(r.widgetOrder) ? r.widgetOrder.filter((id): id is string => typeof id === 'string' && WIDGET_IDS.includes(id)) : []
  const widgetOrder = [...new Set([...order, ...WIDGET_IDS])]
  const savedLayout = r.layout && typeof r.layout === 'object' ? r.layout as Record<string, unknown> : {}
  const layout = { ...DEFAULT.layout }
  for (const key of Object.keys(layout) as (keyof LayoutFlags)[]) if (typeof savedLayout[key] === 'boolean') layout[key] = savedLayout[key] as boolean
  return { gauges: normalizeGauges(r.gauges), layout, widgetOrder, chartOrder, chartCfg, panelSizes: sanitizePanelSizes(r.panelSizes) }
}

/** Saved profiles, repaired; the active profile always gets a valid entry. */
function normalizeProfiles(saved: unknown, activeId: unknown, working: ProfileData): { profiles: Profile[]; activeProfileId: string } {
  const out: Profile[] = []
  if (Array.isArray(saved)) {
    for (const item of saved) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      if (typeof p.id !== 'string' || !p.id || out.some(o => o.id === p.id)) continue
      out.push({
        id: p.id,
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 40) : 'Profile',
        ...(typeof p.presetId === 'string' && PRESET_BY_ID[p.presetId] ? { presetId: p.presetId } : {}),
        data: normalizeProfileData(p.data),
      })
    }
  }
  if (out.length === 0) out.push({ id: 'main', name: 'Main', data: working })
  const activeProfileId = typeof activeId === 'string' && out.some(p => p.id === activeId) ? activeId : out[0].id
  return { profiles: out, activeProfileId }
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
  /** Drag a trace back onto the channel list: remove it (an emptied chart is removed too). */
  discardTrace: (chartId: string, index: number) => void
  setTelemetrySource: (source: TelemetrySource) => void
  setWsUrl: (url: string) => void
  setSupabaseUrl: (url: string) => void
  setSupabaseAnonKey: (key: string) => void
  setTelemetrySessionId: (id: string) => void
  setTelemetryDeviceId: (id: string) => void
  setSupabaseMode: (mode: SupabaseMode) => void
  setStaleAfterMs: (ms: number) => void
  /** Pass null (or the base unit) to go back to the channel's own unit. */
  setUnitPref: (key: string, unit: string | null) => void
  setAutoZero: (key: string, on: boolean) => void
  setRestCondition: (expr: string) => void
  setRestHoldS: (s: number) => void
  /** Set (number) or clear (null) dragged panel sizes in the active profile. */
  setPanelSizes: (patch: Record<string, number | null>) => void
  resetPanelSizes: () => void
  // profiles (whole-screen layouts)
  switchProfile: (id: string) => void
  /** Add a profile from a preset id, or a blank one when omitted. */
  addProfile: (presetId?: string) => void
  duplicateProfile: () => void
  renameProfile: (id: string, name: string) => void
  deleteProfile: (id: string) => void
  /** Reload the active profile's layout from the preset it started from. */
  resetProfileToPreset: () => void
  exportProfile: (id: string) => string | null
  /** Returns an error message, or null on success. */
  importProfile: (text: string) => string | null
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

/**
 * Remove one trace (drag it back to the channel list). A chart left with no traces
 * disappears, as when its last trace is dragged to another chart.
 */
export function discardTrace(s: ConfigState, chartId: string, index: number): ConfigState {
  const chart = s.chartCfg[chartId]
  if (!chart || !Number.isInteger(index) || index < 0 || index >= chart.traces.length) return s
  const traces = chart.traces.filter((_, i) => i !== index)
  if (traces.length > 0) return { ...s, chartCfg: { ...s.chartCfg, [chartId]: { ...chart, traces } } }
  const chartCfg = { ...s.chartCfg }
  delete chartCfg[chartId]
  return { ...s, chartCfg, chartOrder: s.chartOrder.filter(id => id !== chartId) }
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
        if (!saved.wheelReferenceAdded) {
          const wheels = merged.chartCfg.wheels
          if (wheels && wheels.traces.some(t => ['wFL', 'wFR', 'wRL', 'wRR'].includes(t.channel)) && !wheels.traces.some(t => t.channel === 'wheelRef')) {
            merged.chartCfg.wheels = { ...wheels, traces: [...wheels.traces, makeTrace('wheelRef')] }
          }
        }
        merged.wheelReferenceAdded = true
        merged.timeRange = normalizeTimeRange(saved.timeRange)
        merged.gauges = normalizeGauges(saved.gauges)
        merged.layout = { ...DEFAULT.layout, ...saved.layout }
        // Logger channels used to be keyed by bare name (t_MAT); they are now channel ids (raw:t_MAT).
        const loggerKey = (k: string) => LOGGER_CHANNEL_BY_NAME[k]?.id ?? k
        merged.panelSizes = sanitizePanelSizes(saved.panelSizes)
        merged.unitPrefs = Object.fromEntries(Object.entries(sanitizeUnitPrefs(saved.unitPrefs)).map(([k, v]) => [loggerKey(k), v]))
        merged.autoZero = Array.isArray(saved.autoZero) ? [...new Set(saved.autoZero.filter((k): k is string => typeof k === 'string').map(loggerKey))] : DEFAULT.autoZero
        if (typeof saved.restCondition !== 'string' || saved.restCondition === OLD_DEFAULT_REST_CONDITION) merged.restCondition = DEFAULT.restCondition
        if (typeof saved.restHoldS !== 'number' || !Number.isFinite(saved.restHoldS) || saved.restHoldS < 0) merged.restHoldS = DEFAULT.restHoldS
        if (!merged.widgetOrder.includes('steering')) {
          merged.widgetOrder = [...merged.widgetOrder]
          const gaugesIndex = merged.widgetOrder.indexOf('gauges')
          merged.widgetOrder.splice(gaugesIndex + 1, 0, 'steering')
        }
        Object.assign(merged, normalizeProfiles(saved.profiles, saved.activeProfileId, snapshotOf(merged)))
        return merged
      }
    } catch { /* ignore */ }
    return { ...DEFAULT, ...normalizeProfiles(null, null, snapshotOf(DEFAULT)) }
  })
  const [configTarget, setConfigTarget] = useState<ConfigTarget | null>(null)

  useEffect(() => {
    // The active profile's stored copy is refreshed on save (switching also does it).
    try { localStorage.setItem(KEY, JSON.stringify(syncActive(state))) } catch { /* ignore */ }
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
    discardTrace: (chartId, index) => setState(s => discardTrace(s, chartId, index)),
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
    setUnitPref: (key, unit) => setState(s => {
      const unitPrefs = { ...s.unitPrefs }
      if (unit === null) delete unitPrefs[key]
      else unitPrefs[key] = unit
      return { ...s, unitPrefs }
    }),
    setAutoZero: (key, on) => setState(s => ({ ...s, autoZero: on ? [...new Set([...s.autoZero, key])] : s.autoZero.filter(k => k !== key) })),
    setRestCondition: restCondition => setState(s => ({ ...s, restCondition })),
    setRestHoldS: restHoldS => setState(s => ({ ...s, restHoldS })),
    setPanelSizes: patch => setState(s => ({ ...s, panelSizes: applySizePatch(s.panelSizes, patch) })),
    resetPanelSizes: () => setState(s => ({ ...s, panelSizes: {} })),
    switchProfile: id => {
      setConfigTarget(null)
      setState(s => switchProfile(s, id))
    },
    addProfile: presetId => {
      setConfigTarget(null)
      setState(s => {
        const spec = presetId ? PRESET_BY_ID[presetId] : PRESET_BY_ID.blank
        return spec ? addProfile(s, { name: spec.name, data: buildPresetData(spec, makeTrace, DEFAULT.layout, DEFAULT.widgetOrder), presetId: spec.id }) : s
      })
    },
    duplicateProfile: () => {
      setConfigTarget(null)
      setState(s => duplicateProfile(s))
    },
    renameProfile: (id, name) => setState(s => renameProfile(s, id, name)),
    deleteProfile: id => {
      setConfigTarget(null)
      setState(s => deleteProfile(s, id))
    },
    resetProfileToPreset: () => {
      setConfigTarget(null)
      setState(s => {
        const spec = PRESET_BY_ID[s.profiles.find(p => p.id === s.activeProfileId)?.presetId ?? '']
        return spec ? replaceActive(s, buildPresetData(spec, makeTrace, DEFAULT.layout, DEFAULT.widgetOrder)) : s
      })
    },
    exportProfile: id => exportProfile(syncActive(state), id),
    importProfile: text => {
      const result = parseProfileImport(text, normalizeProfileData)
      if (!result.ok) return result.reason
      setConfigTarget(null)
      setState(s => addProfile(s, { name: result.name, data: result.data, presetId: result.presetId && PRESET_BY_ID[result.presetId] ? result.presetId : undefined }))
      return null
    },
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
      panelSizes: {},
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
