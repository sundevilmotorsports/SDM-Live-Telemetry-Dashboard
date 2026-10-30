import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { CHART_BASE } from '../telemetry/simulation'

// ── Config types ─────────────────────────────────────────────────────────────
export interface ChartConfig {
  channel: string
  color: string
  min: number
  max: number
  warnAt: number | null
  dangerAt: number | null
}

export type TelemetrySource = 'simulation' | 'websocket' | 'supabase'

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

export interface GaugeConfig {
  id: string
  channel: string       // channel id (or math:<id>)
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
  telemetrySource: TelemetrySource
  wsUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
  telemetrySessionId: string
  staleAfterMs: number
}

const DEFAULT_CHART_CFG: Record<string, ChartConfig> = Object.fromEntries(
  CHART_BASE.map(c => [c.id, { channel: c.channel, color: c.color, min: c.min, max: c.max, warnAt: null, dangerAt: null }]),
)

const DEFAULT: ConfigState = {
  gauges: [
    { id: 'g1', channel: 'speed', min: 0, max: 240, warnAt: null, dangerAt: null },
    { id: 'g2', channel: 'rpm', min: 0, max: 8000, warnAt: 6800, dangerAt: 7400 },
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
  telemetrySource: 'simulation',
  wsUrl: 'ws://localhost:8765',
  supabaseUrl: envString('VITE_SUPABASE_URL'),
  supabaseAnonKey: envString('VITE_SUPABASE_ANON_KEY'),
  telemetrySessionId: envString('VITE_TELEMETRY_SESSION_ID'),
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
  setTelemetrySource: (source: TelemetrySource) => void
  setWsUrl: (url: string) => void
  setSupabaseUrl: (url: string) => void
  setSupabaseAnonKey: (key: string) => void
  setTelemetrySessionId: (id: string) => void
  setStaleAfterMs: (ms: number) => void
  reset: () => void
  // contextual config modal control
  configTarget: ConfigTarget | null
  openConfig: (target: ConfigTarget) => void
  closeConfig: () => void
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
        if (!saved.staleAfterMs) merged.staleAfterMs = DEFAULT.staleAfterMs
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
    updateChart: (id, patch) => setState(s => ({ ...s, chartCfg: { ...s.chartCfg, [id]: { ...s.chartCfg[id], ...patch } } })),
    setTelemetrySource: telemetrySource => setState(s => ({ ...s, telemetrySource })),
    setWsUrl: wsUrl => setState(s => ({ ...s, wsUrl })),
    setSupabaseUrl: supabaseUrl => setState(s => ({ ...s, supabaseUrl })),
    setSupabaseAnonKey: supabaseAnonKey => setState(s => ({ ...s, supabaseAnonKey })),
    setTelemetrySessionId: telemetrySessionId => setState(s => ({ ...s, telemetrySessionId })),
    setStaleAfterMs: staleAfterMs => setState(s => ({ ...s, staleAfterMs })),
    reset: () => setState(DEFAULT),
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
