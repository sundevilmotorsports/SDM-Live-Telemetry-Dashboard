import type { Frame } from '../simulation'
import type { ChannelState } from '../live/types'
import { emptyFrame, type MappedFrame } from '../live/mapToFrame'

/**
 * Raw channel names/config: sundevilmotorsports/logger@9338e3cfb6c77be5bfc485b3cc75e502d610514e
 * https://github.com/sundevilmotorsports/logger/blob/9338e3cfb6c77be5bfc485b3cc75e502d610514e/config.json

 * Values have already passed through logger scaling. Never apply it again here.
 * Pressure units, IMU axes/units, wheel circumference, suspension units, and ADC
 * steering calibration are insufficiently specified; those fields stay unavailable.
 */
export const RAW_DASHBOARD_MAPPINGS: { field: keyof Frame; channelId: string; note: string }[] = [
  { field: 'rpm', channelId: 'r_engine', note: 'Engine rpm; already decoded' },
  { field: 'throttle', channelId: '%_TPS', note: 'Throttle plate percent, not accelerator pedal' },
  { field: 'gear', channelId: 'n-Gear', note: 'Dimensionless; display as received' },
  { field: 'coolant', channelId: 't_eng_coolant', note: 'Coolant temperature; preserve firmware offset semantics' },
  { field: 'oilTemp', channelId: 't_oil', note: 'Oil temperature; preserve firmware offset semantics' },
  { field: 'fuel', channelId: '%_fuel_left', note: 'Fuel percent; already decoded' },
]

function safeTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

/** sessionStartUs is fixed by the caller to the earliest accepted time for this device. */
export function rawChannelsToFrame(state: ChannelState, sessionStartUs: number | null, latestSampleUs: number | null = null): MappedFrame {
  const frame = emptyFrame()
  for (const { field, channelId } of RAW_DASHBOARD_MAPPINGS) {
    const sample = state[channelId]
    if (sample && Number.isFinite(sample.value)
      && (!Number.isInteger(sample.value) || Number.isSafeInteger(sample.value))) {
      frame[field] = sample.value
    }
  }

  if (sessionStartUs !== null && safeTimestamp(sessionStartUs)) {
    // Opaque-only samples advance the display clock without inventing a numeric value.
    let newest: number | null = latestSampleUs !== null && safeTimestamp(latestSampleUs) && latestSampleUs >= sessionStartUs
      ? latestSampleUs : null
    for (const sample of Object.values(state)) {
      if (safeTimestamp(sample.tUs) && sample.tUs >= sessionStartUs
        && (newest === null || sample.tUs > newest)) newest = sample.tUs
    }
    if (newest !== null) frame.t = (newest - sessionStartUs) / 1_000_000
  }

  const mappedIds = new Set(RAW_DASHBOARD_MAPPINGS.map(mapping => mapping.channelId))
  return {
    frame,
    unavailableFields: (Object.keys(frame) as (keyof Frame)[]).filter(field => !Number.isFinite(frame[field])),
    unmappedChannels: Object.keys(state).filter(id => !mappedIds.has(id)),
  }
}
