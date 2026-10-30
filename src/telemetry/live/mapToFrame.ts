import { Frame } from '../simulation'
import { LIVE_CHANNEL_MAP } from './channelSet1'
import type { ChannelState } from './types'

export type DashboardField =
  | 'speed' | 'rpm' | 'throttle' | 'brake' | 'steering'
  | 'volt' | 'coolant' | 'oilTemp' | 'oilPress'
  | 'gX' | 'gY' | 'gear'

export interface FieldMapping {
  field: DashboardField
  channelId: string
  /** Multiply the decoded channel by this. 1 means the units already match. */
  toDashboard: number
  note: string
}

/**
 * Explicit channel-id → dashboard-field mapping.
 * Units were checked against docs/channels.yaml. Only oil pressure needs a
 * conversion (kPa → bar). Wheel rpm is not converted to km/h: tire circumference
 * is not in the channel set. GPS speed (m/s) is not used as vehicle speed.
 * imu sign convention has not been verified on hardware.
 */
export const DASHBOARD_FIELD_MAPPINGS: FieldMapping[] = [
  { field: 'speed', channelId: 'drivetrain.vehicle_speed', toDashboard: 1, note: 'km/h already' },
  { field: 'rpm', channelId: 'engine.rpm', toDashboard: 1, note: 'rpm already' },
  { field: 'throttle', channelId: 'engine.tps', toDashboard: 1, note: 'percent already; plate position, not pedal' },
  { field: 'brake', channelId: 'brake.front_pressure', toDashboard: 1, note: 'kPa already; rear pressure stays unmapped' },
  { field: 'steering', channelId: 'chassis.steering_angle', toDashboard: 1, note: 'degrees already; sign not hardware-verified' },
  { field: 'volt', channelId: 'engine.battery_voltage', toDashboard: 1, note: 'volts already' },
  { field: 'coolant', channelId: 'engine.water_temp', toDashboard: 1, note: '°C already' },
  { field: 'oilTemp', channelId: 'engine.oil_temp', toDashboard: 1, note: '°C already' },
  { field: 'oilPress', channelId: 'engine.oil_pressure', toDashboard: 0.01, note: 'kPa → bar' },
  { field: 'gX', channelId: 'imu.lat_g', toDashboard: 1, note: 'g already; left/right sign not hardware-verified' },
  { field: 'gY', channelId: 'imu.long_g', toDashboard: 1, note: 'g already; accel/brake sign not hardware-verified' },
  { field: 'gear', channelId: 'engine.gear', toDashboard: 1, note: 'dimensionless; displayed as received' },
]

/** Dashboard fields with no channel in SDM26-cell-v1. Render as unavailable, never as a default. */
export const UNMAPPED_DASHBOARD_FIELDS = [
  'fuel',
  'lapTime',
  'lapNum',
  'wFL',
  'wFR',
  'wRL',
  'wRR',
  'suspFL',
  'suspFR',
  'suspRL',
  'suspRR',
] as const

export interface MappedFrame {
  frame: Frame
  /** Dashboard fields still NaN because the channel has not arrived or is unmapped. */
  unavailableFields: string[]
  /** Broadcast channel ids that have no dashboard field. */
  unmappedChannels: string[]
}

/**
 * Build one dashboard snapshot from merged channel state.
 * `t` is seconds since the earliest accepted sample in this session — a local
 * display clock, not a measured lap time and not an interpolated sample.
 * GPS lat/lon are reconstructed only as inspection values (ref + delta); they
 * do not move the circuit-map car, which is geometry driven by lap fraction.
 */
export function channelsToFrame(state: ChannelState, sessionStartUs: number | null): MappedFrame {
  const frame = emptyFrame()
  const missing: string[] = []

  for (const mapping of DASHBOARD_FIELD_MAPPINGS) {
    const sample = state[mapping.channelId]
    if (!sample || !Number.isFinite(sample.value)) {
      missing.push(mapping.field)
      continue
    }
    frame[mapping.field] = sample.value * mapping.toDashboard
  }

  if (sessionStartUs !== null) {
    let newest = sessionStartUs
    for (const sample of Object.values(state)) {
      if (sample.tUs > newest) newest = sample.tUs
    }
    frame.t = (newest - sessionStartUs) / 1_000_000
  }

  for (const field of UNMAPPED_DASHBOARD_FIELDS) missing.push(field)

  const mappedIds = new Set(DASHBOARD_FIELD_MAPPINGS.map(mapping => mapping.channelId))
  const unmappedChannels = Object.keys(state).filter(id => !mappedIds.has(id))

  return { frame, unavailableFields: missing, unmappedChannels }
}

export function sessionStartUs(state: ChannelState): number | null {
  let earliest: number | null = null
  for (const sample of Object.values(state)) {
    if (earliest === null || sample.tUs < earliest) earliest = sample.tUs
  }
  return earliest
}

/** Reconstruct gps.lat / gps.lon per the wire spec. Null unless both halves are present. */
export function gpsPosition(state: ChannelState): { lat: number; lon: number } | null {
  const latRef = state['gps.lat_ref']
  const latD = state['gps.lat_d']
  const lonRef = state['gps.lon_ref']
  const lonD = state['gps.lon_d']
  if (!latRef || !latD || !lonRef || !lonD) return null
  if (![latRef, latD, lonRef, lonD].every(sample => Number.isFinite(sample.value))) return null
  return { lat: latRef.value + latD.value, lon: lonRef.value + lonD.value }
}

export function channelLabel(id: string): string {
  return LIVE_CHANNEL_MAP[id]?.label ?? id
}

function emptyFrame(): Frame {
  return {
    t: NaN,
    speed: NaN,
    rpm: NaN,
    gear: NaN,
    throttle: NaN,
    brake: NaN,
    steering: NaN,
    wFL: NaN,
    wFR: NaN,
    wRL: NaN,
    wRR: NaN,
    volt: NaN,
    coolant: NaN,
    oilTemp: NaN,
    oilPress: NaN,
    fuel: NaN,
    gX: NaN,
    gY: NaN,
    lapTime: NaN,
    lapNum: NaN,
    suspFL: NaN,
    suspFR: NaN,
    suspRL: NaN,
    suspRR: NaN,
  }
}
