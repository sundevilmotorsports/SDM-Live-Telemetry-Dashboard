// Shared types for the Supabase Realtime Broadcast telemetry source.
// Transport, merge, and dashboard mapping stay independent of rendering.

export type DataFreshness = 'no-data' | 'fresh' | 'stale'

/** Socket/channel lifecycle. Distinct from whether samples are still arriving. */
export type LiveConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'subscribed'
  | 'reconnecting'
  | 'disconnected'
  | 'error'
  | 'misconfigured'

export interface LiveMessage {
  seq: number
  sendTimestampMs: number
  tUs: number
  values: Record<string, number>
  rejectedValueCount: number
}

export type ParseFailure =
  | 'not-object'
  | 'missing-payload'
  | 'seq'
  | 'send_timestamp_ms'
  | 't_us'
  | 'values'

export type ParseResult =
  | { ok: true; message: LiveMessage }
  | { ok: false; reason: ParseFailure }

export interface ChannelSample {
  value: number
  /** Device sample time, Unix microseconds. Compared with <=, never bitwise-truncated. */
  tUs: number
  /** Local wall-clock time this sample was accepted. Not the device clock. */
  receivedAtMs: number
}

export type ChannelState = Record<string, ChannelSample>

export interface MergeResult {
  state: ChannelState
  acceptedIds: string[]
  ignoredOldCount: number
  rejectedValueCount: number
}

export interface LiveDiagnostics {
  received: number
  accepted: number
  invalid: number
  ignoredOld: number
  rejectedValues: number
  /** Local time of the last structurally valid or invalid broadcast. */
  lastReceiptMs: number | null
  /** Local time of the last broadcast that accepted at least one newer sample. */
  lastAcceptedMs: number | null
  /** Newest accepted device sample time, Unix microseconds. */
  latestSampleUs: number | null
  lastSendTimestampMs: number | null
  lastSeq: number | null
  /**
   * receivedAt - send_timestamp_ms. Clock skew can dominate this; it is an estimate,
   * not a measured network latency.
   */
  uplinkEstimateMs: number | null
  /**
   * receivedAt - t_us/1000. Also an estimate: the two clocks are not synchronized.
   */
  sampleAgeEstimateMs: number | null
  groupsSeen: number[]
  lastError: string | null
}

export const EMPTY_DIAGNOSTICS: LiveDiagnostics = {
  received: 0,
  accepted: 0,
  invalid: 0,
  ignoredOld: 0,
  rejectedValues: 0,
  lastReceiptMs: null,
  lastAcceptedMs: null,
  latestSampleUs: null,
  lastSendTimestampMs: null,
  lastSeq: null,
  uplinkEstimateMs: null,
  sampleAgeEstimateMs: null,
  groupsSeen: [],
  lastError: null,
}
