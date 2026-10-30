// ── Telemetry simulation: frames, channels, track geometry ──────────────────

export const BUFFER = 180
export const HZ = 10
export const MONO = "'JetBrains Mono', monospace"
export const LAP_LEN = 90 // seconds per simulated lap

export interface Frame {
  t: number
  throttle: number
  brake: number
  steering: number
  wFL: number; wFR: number; wRL: number; wRR: number
  volt: number
  coolant: number
  oilTemp: number
  oilPress: number
  fuel: number
  gX: number; gY: number
  speed: number
  rpm: number
  gear: number
  lapTime: number
  lapNum: number
  suspFL: number; suspFR: number; suspRL: number; suspRR: number
}

export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
export function rand(mag: number) { return (Math.random() - 0.5) * 2 * mag }

// Deterministic per-lap pseudo-random in [-1,1] so recorded lap/sector times are stable
export function seeded(a: number, b = 0) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

export function makeFrame(t: number): Frame {
  const lap = (t % LAP_LEN) / LAP_LEN
  const throttle = clamp(55 + 42 * Math.sin(lap * Math.PI * 4 - 0.5) + rand(3), 0, 100)
  const brake = clamp(Math.max(0, -85 * Math.sin(lap * Math.PI * 4 - 0.5)) * 1.8 + rand(5), 0, 200)
  const steering = 72 * Math.sin(lap * Math.PI * 5 + 1) + 18 * Math.sin(lap * Math.PI * 11) + rand(1)
  const spd = clamp(22 + 115 * Math.max(0, Math.sin(lap * Math.PI * 2.5 - 0.4)) + rand(2), 0, 230)
  const gear = clamp(Math.round(spd / 28) + 1, 1, 7)
  const rpm = clamp(800 + (spd / (gear * 6)) * 6200 + rand(120), 800, 8000)
  const lapNum = Math.floor(t / LAP_LEN) + 1
  return {
    t, throttle, brake, steering,
    wFL: clamp(spd - 2 + rand(1.5), 0, 240),
    wFR: clamp(spd + 1.5 + rand(1.5), 0, 240),
    wRL: clamp(spd * 1.06 - 1 + rand(2), 0, 240),
    wRR: clamp(spd * 1.06 + 2.5 + rand(2), 0, 240),
    volt: clamp(12.5 + 1.2 * Math.sin(t * 0.08) + 0.3 * Math.sin(t * 0.3) + rand(0.04), 10, 16),
    coolant: clamp(87 + 15 * Math.sin(t * 0.035 + 0.5) + rand(0.2), 40, 130),
    oilTemp: clamp(95 + 18 * Math.sin(t * 0.03 + 1.2) + rand(0.2), 50, 140),
    oilPress: clamp(4.2 + 1.1 * Math.sin(lap * Math.PI * 4) + (rpm / 8000) * 1.2 + rand(0.05), 1, 7),
    fuel: clamp(100 - (t / LAP_LEN) * 3.4, 0, 100),
    gX: (steering / 72) * 2.4 + rand(0.04),
    gY: ((throttle / 100) - (brake / 200)) * 2.0 + rand(0.04),
    speed: spd, rpm, gear,
    lapTime: t % LAP_LEN,
    lapNum,
    suspFL: clamp(-(throttle / 100 - brake / 200) * 180 + (steering / 72) * 120 + rand(70), -400, 400),
    suspFR: clamp(-(throttle / 100 - brake / 200) * 180 - (steering / 72) * 120 + rand(70), -400, 400),
    suspRL: clamp((throttle / 100 - brake / 200) * 120 + (steering / 72) * 90 + rand(90), -400, 400),
    suspRR: clamp((throttle / 100 - brake / 200) * 120 - (steering / 72) * 90 + rand(90), -400, 400),
  }
}

// ── Channel registry — data-driven scaling/coloring for gauges & math ────────
export interface ChannelDef {
  id: string
  label: string
  unit: string
  min: number
  max: number
  color: string
  get: (f: Frame) => number
}

export const CHANNELS: ChannelDef[] = [
  { id: 'speed', label: 'Speed', unit: 'km/h', min: 0, max: 240, color: '#00ccff', get: f => f.speed },
  { id: 'rpm', label: 'Engine RPM', unit: 'rpm', min: 0, max: 8000, color: '#ff9933', get: f => f.rpm },
  { id: 'throttle', label: 'Throttle', unit: '%', min: 0, max: 100, color: '#00ff41', get: f => f.throttle },
  { id: 'brake', label: 'Brake Pressure', unit: 'kPa', min: 0, max: 200, color: '#ff3333', get: f => f.brake },
  { id: 'steering', label: 'Steering Angle', unit: '°', min: -90, max: 90, color: '#ffff00', get: f => f.steering },
  { id: 'volt', label: 'Battery Voltage', unit: 'V', min: 10, max: 16, color: '#4488ff', get: f => f.volt },
  { id: 'coolant', label: 'Coolant Temp', unit: '°C', min: 40, max: 130, color: '#ff6644', get: f => f.coolant },
  { id: 'oilTemp', label: 'Oil Temp', unit: '°C', min: 50, max: 140, color: '#ff8800', get: f => f.oilTemp },
  { id: 'oilPress', label: 'Oil Pressure', unit: 'bar', min: 0, max: 7, color: '#ffaa00', get: f => f.oilPress },
  { id: 'fuel', label: 'Fuel Level', unit: '%', min: 0, max: 100, color: '#33ff99', get: f => f.fuel },
  { id: 'gX', label: 'G-Force Lat', unit: 'G', min: -3, max: 3, color: '#00ffff', get: f => f.gX },
  { id: 'gY', label: 'G-Force Long', unit: 'G', min: -3, max: 3, color: '#00ffaa', get: f => f.gY },
  { id: 'gear', label: 'Gear', unit: '', min: 0, max: 7, color: '#ffff00', get: f => f.gear },
  { id: 'wFL', label: 'Wheel Speed FL', unit: 'km/h', min: 0, max: 240, color: '#00ffff', get: f => f.wFL },
  { id: 'wFR', label: 'Wheel Speed FR', unit: 'km/h', min: 0, max: 240, color: '#00cccc', get: f => f.wFR },
  { id: 'wRL', label: 'Wheel Speed RL', unit: 'km/h', min: 0, max: 240, color: '#33ffee', get: f => f.wRL },
  { id: 'wRR', label: 'Wheel Speed RR', unit: 'km/h', min: 0, max: 240, color: '#009999', get: f => f.wRR },
  { id: 'suspFL', label: 'Susp Vel FL', unit: 'mm/s', min: -400, max: 400, color: '#00ffff', get: f => f.suspFL },
]

export const CHANNEL_MAP: Record<string, ChannelDef> = Object.fromEntries(CHANNELS.map(c => [c.id, c]))

// ── Time-series chart base definitions (left column) ─────────────────────────
export interface ChartExtra { channel: string; color: string }
export interface ChartBase {
  id: string
  label: string
  channel: string
  color: string
  min: number
  max: number
  gridTicks: number[]
  extra?: ChartExtra[]
}

export const CHART_BASE: ChartBase[] = [
  { id: 'throttle', label: 'THROTTLE', channel: 'throttle', color: '#00ff41', min: 0, max: 100, gridTicks: [0, 25, 50, 75, 100] },
  { id: 'brake', label: 'BRAKE PRESSURE', channel: 'brake', color: '#ff3333', min: 0, max: 200, gridTicks: [0, 50, 100, 150, 200] },
  { id: 'steering', label: 'STEERING ANGLE', channel: 'steering', color: '#ffff00', min: -90, max: 90, gridTicks: [-90, -45, 0, 45, 90] },
  {
    id: 'wheels', label: 'WHEEL SPEEDS', channel: 'wFL', color: '#00ffff', min: 0, max: 240, gridTicks: [0, 60, 120, 180, 240],
    extra: [{ channel: 'wFR', color: '#00cccc' }, { channel: 'wRL', color: '#33ffee' }, { channel: 'wRR', color: '#009999' }],
  },
]

export const CHART_BASE_MAP: Record<string, ChartBase> = Object.fromEntries(CHART_BASE.map(c => [c.id, c]))

// Build the numeric scope object used by the expression evaluator
export function frameScope(f: Frame): Record<string, number> {
  const s: Record<string, number> = {}
  for (const c of CHANNELS) s[c.id] = c.get(f)
  return s
}

/** Display helper. Non-finite means the channel is unmapped or has not arrived — never a measured zero. */
export function fmtNum(v: number, digits = 0): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '—'
}

export function fmtTime(s: number) {
  if (!isFinite(s)) return '—:—.—'
  const m = Math.floor(s / 60)
  const frac = s % 60
  const whole = Math.floor(frac).toString().padStart(2, '0')
  const dec = (frac % 1).toFixed(3).slice(2)
  return `${m}:${whole}.${dec}`
}

export function fmtDelta(s: number) {
  if (!isFinite(s)) return '—'
  const sign = s > 0 ? '+' : s < 0 ? '-' : ''
  return `${sign}${Math.abs(s).toFixed(3)}`
}

// ── Track geometry ──────────────────────────────────────────────────────────
export const TRACK_PATH = `M 30 120 L 155 120 C 168 120 178 112 178 100 L 178 82 C 178 68 170 60 156 57 L 140 54 C 128 52 122 43 128 36 C 132 28 143 24 138 16 L 100 12 L 55 12 C 35 12 18 22 18 38 C 18 52 28 58 40 58 C 55 56 62 64 62 74 C 62 84 50 92 32 94 C 20 96 16 108 20 118 L 30 120`

export const TRACK_WP: [number, number][] = [
  [30, 120], [70, 120], [115, 120], [148, 120], [158, 120],
  [170, 118], [176, 110], [178, 100], [178, 91], [178, 82],
  [178, 75], [176, 67], [170, 61], [160, 57], [150, 55], [140, 54],
  [132, 53], [126, 49], [122, 44], [124, 39], [127, 34],
  [131, 28], [136, 22], [138, 16], [130, 14], [114, 13],
  [100, 12], [80, 12], [65, 12], [55, 12],
  [43, 12], [33, 14], [24, 20], [18, 29], [18, 38],
  [18, 46], [20, 54], [27, 58], [36, 58], [44, 57],
  [53, 56], [59, 60], [62, 67], [62, 74], [62, 80],
  [60, 87], [54, 92], [44, 94], [34, 94], [25, 96],
  [19, 102], [16, 110], [17, 117], [23, 120], [30, 120],
]

export const S1_IDX = 17
export const S2_IDX = 34
// Sector boundary fractions of the lap (0..1)
export const SECTOR_BOUNDS = [S1_IDX / (TRACK_WP.length - 1), S2_IDX / (TRACK_WP.length - 1)]

export function interpolateTrack(frac: number): [number, number] {
  const n = TRACK_WP.length - 1
  const t = frac * n
  const i = Math.floor(t) % n
  const f = t - Math.floor(t)
  const [x1, y1] = TRACK_WP[i]
  const [x2, y2] = TRACK_WP[(i + 1) % TRACK_WP.length]
  return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f]
}
