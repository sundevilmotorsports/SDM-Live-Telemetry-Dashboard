import { loggerConfig, type CanSignal, type LoggerConfig } from './decodeCanFrame'
import { RAW_DASHBOARD_MAPPINGS } from './rawMappings'
import { rawChannelUnit } from '../units'

/**
 * Catalog of every channel in the logger's config.json (CAN signals and ADC inputs),
 * like the channel list of a MoTeC i2 project: each logged channel is listed, grouped,
 * and usable in charts, gauges, and math. Generated from the vendored config, so a
 * config change flows through without dashboard edits.
 */
export type LoggerChannelKind =
  /** Decoded to a number and can be charted. */
  | 'numeric'
  /** Wider than a safe integer with no scale (e.g. 8-byte tyre temperature arrays): shown as hex only. */
  | 'opaque'
  /** Logger ADC input: read and logged by the logger but never transmitted on CAN. */
  | 'not-transmitted'

export interface LoggerChannel {
  name: string
  /** Dashboard channel id: `raw:<name>`, or the dashboard field it is mapped to (e.g. `rpm`). */
  id: string
  kind: LoggerChannelKind
  group: string
  /** e.g. "CAN 0x3E8 mux 1, bytes 2–2" or "Logger ADC ch 6". */
  source: string
  unit: string
  /** Full-scale range from the signal's width, sign, and scale (ADC: 12-bit counts). */
  min: number
  max: number
  /** Set when a dashboard field already shows this channel (e.g. r_engine → rpm). */
  mappedField?: string
  /** Why it has no live data, for channels that cannot be displayed yet. */
  note?: string
}

export const RAW_CHANNEL_PREFIX = 'raw:'

const GROUPS: [number, number, string][] = [
  [0x100, 0x101, 'Fuel Flow'],
  [0x102, 0x102, 'Temperatures'],
  [0x35f, 0x35f, 'Aero'],
  [0x360, 0x361, 'IMU'],
  [0x370, 0x3a2, 'Wheels & Tyres'],
  [0x3b0, 0x3b0, 'Pots (0x3B0)'],
  [0x3e8, 0x3eb, 'Engine (ECU)'],
  [0x3ec, 0x3ec, 'IMU'],
  [0x4e2, 0x4e5, 'Strain Gauges'],
]

export const ADC_GROUP = 'Logger ADC'
const ADC_NOTE = 'Read by the logger’s own ADC and written to its SD card only; the logger never sends it on CAN, so the transmitter cannot see it. See docs/logger-channels.md for the CAN broadcast that would make it live.'
const OPAQUE_NOTE = 'Eight raw bytes with no scale in config.json (wider than a number can hold exactly). Shown as hex until the sensor’s byte layout is added to config.json; see docs/logger-channels.md.'

function groupFor(canId: number): string {
  return GROUPS.find(([lo, hi]) => canId >= lo && canId <= hi)?.[2] ?? `CAN 0x${canId.toString(16).toUpperCase()}`
}

function hex(id: number): string {
  return `0x${id.toString(16).toUpperCase()}`
}

/** Mirrors decodeCanFrame: no scale = raw unsigned bytes; scaled = 1/2/4/8-byte integer × scale. */
function rangeOf(signal: CanSignal): { min: number; max: number; opaque: boolean } {
  const scaled = signal.scale !== undefined && signal.scale !== null
  const bits = (scaled ? ([1, 2, 4].includes(signal.len) ? signal.len : 8) : signal.len) * 8
  if (bits > 53 && !scaled) return { min: 0, max: 0, opaque: true }
  const signed = scaled && (signal.signed === true || bits === 64)
  const lo = signed ? -(2 ** (bits - 1)) : 0
  const hi = signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1
  if (!scaled) return { min: lo, max: hi, opaque: false }
  const a = signal.scale! * (lo - (signal.offset ?? 0))
  const b = signal.scale! * (hi - (signal.offset ?? 0))
  return { min: Math.min(a, b), max: Math.max(a, b), opaque: false }
}

/** Display ranges that make sense on a chart where the full integer range would not. */
function displayRange(unit: string, full: { min: number; max: number }): { min: number; max: number } {
  if (unit === '%') return { min: 0, max: 100 }
  if (unit === 'rpm') return { min: 0, max: Math.min(full.max, 12000) }
  if (unit === '°C') return { min: Math.max(full.min, -20), max: Math.min(full.max, 150) }
  return full
}

export function buildLoggerChannels(config: LoggerConfig & { adc_channels?: { name: string; channel: number }[] } = loggerConfig): LoggerChannel[] {
  const mapped = new Map(RAW_DASHBOARD_MAPPINGS.map(m => [m.channelId, m.field as string]))
  const out: LoggerChannel[] = []
  const seen = new Set<string>()
  for (const device of config.can_devices) {
    const groups = 'Fixed' in device.signals
      ? [{ label: '', signals: device.signals.Fixed }]
      : device.signals.Muxed.groups.map(g => ({ label: ` mux ${g.type_val}`, signals: g.signals }))
    for (const g of groups) {
      for (const signal of g.signals) {
        if (seen.has(signal.name)) continue
        seen.add(signal.name)
        const range = rangeOf(signal)
        const unit = rawChannelUnit(signal.name)
        const field = mapped.get(signal.name)
        out.push({
          name: signal.name,
          id: field ?? RAW_CHANNEL_PREFIX + signal.name,
          kind: range.opaque ? 'opaque' : 'numeric',
          group: groupFor(device.id),
          source: `CAN ${hex(device.id)}${device.extended ? ' (ext)' : ''}${g.label}, bytes ${signal.start}–${signal.start + signal.len - 1}`,
          unit,
          ...(range.opaque ? { min: 0, max: 0 } : displayRange(unit, range)),
          ...(field ? { mappedField: field } : {}),
          ...(range.opaque ? { note: OPAQUE_NOTE } : {}),
        })
      }
    }
  }
  // An ADC input that the logger also broadcasts on CAN (same name in can_devices) is a CAN channel.
  for (const adc of config.adc_channels ?? []) {
    if (seen.has(adc.name)) continue
    seen.add(adc.name)
    out.push({
      name: adc.name, id: RAW_CHANNEL_PREFIX + adc.name, kind: 'not-transmitted', group: ADC_GROUP,
      source: `Logger ADC ch ${adc.channel}`, unit: '', min: 0, max: 4095, note: ADC_NOTE,
    })
  }
  return out
}

export const LOGGER_CHANNELS = buildLoggerChannels()
export const LOGGER_CHANNEL_BY_NAME: Record<string, LoggerChannel> = Object.fromEntries(LOGGER_CHANNELS.map(c => [c.name, c]))

/**
 * Fixed slot per logger channel for Frame.raw. A typed array instead of an object keeps a
 * two-hour 10 Hz history of every channel to ~50 MB rather than ~100+ MB. NaN = no value.
 */
export const LOGGER_INDEX: Record<string, number> = Object.fromEntries(LOGGER_CHANNELS.map((c, i) => [c.name, i]))
export const LOGGER_SLOT_COUNT = LOGGER_CHANNELS.length

/** Decode Frame.raw back to name → value (finite values only). */
export function rawValues(raw: Float64Array | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw) return out
  for (let i = 0; i < LOGGER_CHANNELS.length; i++) if (Number.isFinite(raw[i])) out[LOGGER_CHANNELS[i].name] = raw[i]
  return out
}
