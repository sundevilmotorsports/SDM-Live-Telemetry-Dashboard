/**
 * Display-unit conversion. Data, alerts, and math channels always stay in the
 * channel's base unit; conversion happens only when a value (or a chart/gauge
 * range or threshold) is shown. Every conversion is affine and increasing:
 * display = scale * base + offset.
 */
export interface UnitDef {
  /** Display label, e.g. "km/h". */
  label: string
  scale: number
  offset: number
}

const id = (label: string): UnitDef => ({ label, scale: 1, offset: 0 })
const u = (label: string, scale: number, offset = 0): UnitDef => ({ label, scale, offset })

/** Unit families keyed by the base unit label. The first entry is the base unit itself. */
const FAMILIES: Record<string, UnitDef[]> = {
  'km/h': [id('km/h'), u('m/s', 1 / 3.6), u('mph', 0.621371192237334)],
  'm/s': [id('m/s'), u('km/h', 3.6), u('mph', 2.2369362920544)],
  '°C': [id('°C'), u('°F', 1.8, 32), u('K', 1, 273.15)],
  kPa: [id('kPa'), u('bar', 0.01), u('psi', 0.1450377377)],
  bar: [id('bar'), u('kPa', 100), u('psi', 14.503773773)],
  G: [id('G'), u('m/s²', 9.80665)],
  g: [id('g'), u('m/s²', 9.80665)],
  'mm/s': [id('mm/s'), u('m/s', 0.001), u('in/s', 0.0393700787)],
  mm: [id('mm'), u('cm', 0.1), u('in', 0.0393700787)],
  'deg/s': [id('deg/s'), u('rad/s', Math.PI / 180)],
  '°': [id('°'), u('rad', Math.PI / 180)],
  rpm: [id('rpm'), u('rad/s', (2 * Math.PI) / 60), u('Hz', 1 / 60)],
  V: [id('V'), u('mV', 1000)],
  'L/min': [id('L/min'), u('gal/min', 0.264172052)],
  L: [id('L'), u('gal', 0.264172052)],
}

/** Conversion choices for a base unit. Empty when the unit has no sensible alternatives (%, gear, unknown). */
export function unitOptions(baseUnit: string): UnitDef[] {
  return FAMILIES[baseUnit] ?? []
}

/** The chosen unit if it is a valid choice for this base unit, otherwise the base unit unchanged. */
export function resolveUnit(baseUnit: string, preferred?: string | null): UnitDef {
  const options = FAMILIES[baseUnit]
  return options?.find(o => o.label === preferred) ?? options?.[0] ?? id(baseUnit)
}

/** NaN and ±Infinity pass through unchanged: an unavailable channel is never turned into a number. */
export function convertValue(base: number, unit: UnitDef): number {
  return Number.isFinite(base) ? unit.scale * base + unit.offset : base
}

/** Convert an optional threshold/limit; null stays null. */
export function convertLevel(base: number | null | undefined, unit: UnitDef): number | null {
  return base == null ? null : convertValue(base, unit)
}

/** Gauge/readout decimals: small-magnitude units need one decimal place. */
const ONE_DECIMAL = new Set(['G', 'g', 'V', 'bar', 'm/s', 'm/s²', 'rad', 'rad/s', 'L', 'gal', 'gal/min', 'psi', 'in/s', 'in', 'cm'])
export function decimalsFor(unitLabel: string): number {
  return ONE_DECIMAL.has(unitLabel) ? 1 : 0
}

export type UnitPrefs = Record<string, string>

/** Drop anything that is not a string-to-string map (stored config may be stale or hand-edited). */
export function sanitizeUnitPrefs(value: unknown): UnitPrefs {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string')) as UnitPrefs
}

/**
 * Base units for raw logger channels. loggerConfig.json carries no units, so this
 * infers them only where the channel name states one (%_ prefix, t_ temperature,
 * temp_c_, _lpm_, _l_, r_engine rpm). Everything else stays blank rather than guessed.
 */
export function rawChannelUnit(channelId: string): string {
  if (channelId.startsWith('%_')) return '%'
  if (channelId.startsWith('t_') || channelId.startsWith('temp_c_')) return '°C'
  if (channelId.includes('_lpm_')) return 'L/min'
  if (channelId.startsWith('total_volume_l_')) return 'L'
  if (channelId === 'r_engine' || channelId === 'r_idle_target') return 'rpm'
  return ''
}
