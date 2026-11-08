import { CHANNELS, CHANNEL_MAP, HZ, type Frame } from './simulation'
import { exprIdentifiers } from './expression'
import { DASHBOARD_FIELD_MAPPINGS } from './live/mapToFrame'
import { LIVE_CHANNEL_MAP } from './live/channelSet1'
import { RAW_DASHBOARD_MAPPINGS } from './raw/mapRawToFrame'
import { rawChannelUnit } from './units'
import { LOGGER_CHANNEL_BY_NAME, RAW_CHANNEL_PREFIX } from './raw/loggerChannels'
import type { ChannelStat } from './channelActivity'
import type { MathChannel, SupabaseMode, TelemetrySource } from '../state/ConfigContext'

export interface AvailabilityInput {
  source: TelemetrySource
  mode: SupabaseMode
  /** Per-source-channel activity (supabase sources only). */
  stats: ChannelStat[]
  latest: Frame | undefined
  /** WebSocket only: whether the socket is open. */
  connected: boolean
}

const WHEELS = ['wFL', 'wFR', 'wRL', 'wRR']

/** Dashboard field -> source channel id (and conversion into the dashboard unit) for a supabase mode. */
function fieldSources(mode: SupabaseMode): Record<string, { sourceId: string; toDashboard: number }> {
  const maps = mode === 'raw'
    ? RAW_DASHBOARD_MAPPINGS.map(m => ({ field: m.field as string, sourceId: m.channelId, toDashboard: 1 }))
    : DASHBOARD_FIELD_MAPPINGS.map(m => ({ field: m.field as string, sourceId: m.channelId, toDashboard: m.toDashboard }))
  return Object.fromEntries(maps.map(m => [m.field, { sourceId: m.sourceId, toDashboard: m.toDashboard }]))
}

/**
 * Whether each dashboard channel (chart/gauge channel id, or "math:<id>") is
 * currently receiving data:
 *  - simulation: always.
 *  - websocket: socket open and the latest value is a real number.
 *  - supabase: its source channel had a fresh sample (see ChannelActivityTracker).
 *    The wheel reference needs two live wheel speeds; math channels need every input live.
 */
export function makeAvailability(input: AvailabilityInput): (channelId: string, math: MathChannel[]) => boolean {
  const { source, mode, stats, latest, connected } = input
  const sources = source === 'supabase' ? fieldSources(mode) : {}
  const activeSources = new Set(stats.filter(s => s.active).map(s => s.id))

  const base = (id: string): boolean => {
    // Logger channels exist only in raw CAN mode.
    if (id.startsWith(RAW_CHANNEL_PREFIX)) return source === 'supabase' && mode === 'raw' && activeSources.has(id.slice(RAW_CHANNEL_PREFIX.length))
    if (source === 'simulation') return true
    const def = CHANNEL_MAP[id]
    if (!def) return false
    if (source === 'websocket') return connected && latest !== undefined && Number.isFinite(def.get(latest))
    if (id === 'wheelRef') return WHEELS.filter(w => base(w)).length >= 2
    const src = sources[id]
    return src !== undefined && activeSources.has(src.sourceId)
  }

  const isActive = (id: string, math: MathChannel[]): boolean => {
    if (!id.startsWith('math:')) return base(id)
    const mc = math.find(m => `math:${m.id}` === id)
    if (!mc) return false
    const inputs = exprIdentifiers(mc.expr)
    // Math can name logger channels directly (t_MAT, '%_TPS'); resolve them to their channel id.
    return inputs.length > 0 && inputs.every(name => base(CHANNEL_MAP[name] ? name : LOGGER_CHANNEL_BY_NAME[name]?.id ?? name))
  }
  return isActive
}

export interface ChannelRow {
  /** Unit-preference key: the dashboard channel id when the channel has one, else the source id. */
  key: string
  sourceId: string
  label: string
  /** Channel-list group: Dashboard, a logger group (Engine (ECU), IMU, …), or Broadcast. */
  group: string
  baseUnit: string
  /** In the base unit; convert for display. */
  value: number
  rateHz: number | null
  /** Opaque logger channels (byte arrays): the latest raw bytes, since there is no number to show. */
  hex?: string
}

const DASHBOARD_GROUP = 'Dashboard'

/** Every channel currently receiving data, sorted by group then label. */
export function buildChannelRows(input: AvailabilityInput & {
  packetRate: number
  /** Raw mode: latest bytes of channels with no numeric value, already filtered to recent ones. */
  opaque?: { id: string; hex: string }[]
}): ChannelRow[] {
  const { source, mode, stats, latest, connected, packetRate, opaque = [] } = input
  if (source === 'simulation') {
    return CHANNELS.map(c => ({ key: c.id, sourceId: c.id, label: c.label, group: DASHBOARD_GROUP, baseUnit: c.unit, value: latest ? c.get(latest) : NaN, rateHz: HZ }))
  }
  if (source === 'websocket') {
    if (!connected || !latest) return []
    return CHANNELS
      .filter(c => Number.isFinite(c.get(latest)))
      .map(c => ({ key: c.id, sourceId: c.id, label: c.label, group: DASHBOARD_GROUP, baseUnit: c.unit, value: c.get(latest), rateHz: packetRate > 0 ? packetRate : null }))
  }

  const byFieldSource = new Map(Object.entries(fieldSources(mode)).map(([field, s]) => [s.sourceId, { field, toDashboard: s.toDashboard }]))
  const rows = stats
    .filter(s => s.active)
    .map((s): ChannelRow => {
      const mapped = byFieldSource.get(s.id)
      const def = mapped ? CHANNEL_MAP[mapped.field] : undefined
      const logger = mode === 'raw' ? LOGGER_CHANNEL_BY_NAME[s.id] : undefined
      if (mapped && def) {
        return { key: def.id, sourceId: s.id, label: def.label, group: DASHBOARD_GROUP, baseUnit: def.unit, value: s.value * mapped.toDashboard, rateHz: s.rateHz }
      }
      if (logger) {
        return { key: logger.id, sourceId: s.id, label: s.id, group: logger.group, baseUnit: logger.unit, value: s.value, rateHz: s.rateHz }
      }
      const live = mode === 'broadcast' ? LIVE_CHANNEL_MAP[s.id] : undefined
      return {
        key: s.id, sourceId: s.id, label: live?.label ?? s.id, group: mode === 'broadcast' ? 'Broadcast' : 'Unknown',
        baseUnit: live?.unit ?? (mode === 'raw' ? rawChannelUnit(s.id) : ''),
        value: s.value, rateHz: s.rateHz,
      }
    })
  if (mode === 'raw') {
    for (const o of opaque) {
      const logger = LOGGER_CHANNEL_BY_NAME[o.id]
      if (logger?.kind !== 'opaque') continue
      rows.push({ key: logger.id, sourceId: o.id, label: o.id, group: logger.group, baseUnit: '', value: NaN, rateHz: null, hex: o.hex })
    }
  }
  return rows.sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
}

function groupRank(group: string): number {
  return group === DASHBOARD_GROUP ? 0 : 1
}

/**
 * Raw readings (latest bytes per channel) that are recent: within the stale window of the
 * newest sample, while the stream itself is fresh. Used for byte-only (opaque) channels.
 */
export function recentRawReadings(
  readings: { id: string; hex: string; tUs: number }[],
  latestSampleUs: number | null | undefined,
  staleAfterMs: number,
  fresh: boolean,
): { id: string; hex: string }[] {
  if (!fresh || latestSampleUs == null) return []
  return readings.filter(r => latestSampleUs - r.tUs <= staleAfterMs * 1000)
}
