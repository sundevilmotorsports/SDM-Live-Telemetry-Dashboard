import type { Frame } from '../simulation'
import type { ChannelState } from '../live/types'
import { emptyFrame, type MappedFrame } from '../live/mapToFrame'
import { LOGGER_INDEX, LOGGER_SLOT_COUNT } from './loggerChannels'
import { RAW_DASHBOARD_MAPPINGS, type FrameField } from './rawMappings'

export { RAW_DASHBOARD_MAPPINGS, type FrameField } from './rawMappings'

function safeTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

/** sessionStartUs is fixed by the caller to the earliest accepted time for this device. */
export function rawChannelsToFrame(state: ChannelState, sessionStartUs: number | null, latestSampleUs: number | null = null): MappedFrame {
  const frame = emptyFrame()
  // Every numeric logger channel, so any of them can be charted (raw:<name>) or used in math.
  const raw = new Float64Array(LOGGER_SLOT_COUNT).fill(NaN)
  for (const id in state) {
    const slot = LOGGER_INDEX[id]
    const v = state[id].value
    if (slot !== undefined && Number.isFinite(v)) raw[slot] = v
  }
  frame.raw = raw
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
    unavailableFields: (Object.keys(frame) as (keyof Frame)[]).filter((field): field is FrameField => field !== 'raw').filter(field => !Number.isFinite(frame[field])),
    unmappedChannels: Object.keys(state).filter(id => !mappedIds.has(id)),
  }
}
