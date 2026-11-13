import { sanitizeStatusError } from '../live/broadcastClient'
import { mergeChannels } from '../live/mergeChannelState'
import { EMPTY_DIAGNOSTICS, type ChannelState, type LiveDiagnostics } from '../live/types'
import { decodeCanFrame } from './decodeCanFrame'

export const RAW_POLL_INTERVAL_MS = 1_000
export const RAW_FETCH_TIMEOUT_MS = 10_000
/** First page of a session. The whole session is loaded oldest-first (charts can show all of it). */
export const RAW_BOOTSTRAP_LIMIT = 100
export const RAW_PAGE_LIMIT = 100
export const RAW_MAX_BATCH_FRAMES = 4_096

export type RawBatchStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'misconfigured'

export interface RawBatchDiagnostics extends LiveDiagnostics {
  receivedBatches: number
  decodedFrames: number
  unknownFrames: number
  skippedSignals: number
  droppedFrames: number
  lastBatchId: string | null
}

export const RAW_EMPTY_DIAGNOSTICS: RawBatchDiagnostics = {
  ...EMPTY_DIAGNOSTICS,
  groupsSeen: [],
  receivedBatches: 0,
  decodedFrames: 0,
  unknownFrames: 0,
  skippedSignals: 0,
  droppedFrames: 0,
  lastBatchId: null,
}

export interface RawBatchSnapshot {
  sessionId: string
  status: RawBatchStatus
  channels: ChannelState
  diagnostics: RawBatchDiagnostics
  sessionStartUs: number | null
  rawReadings: { id: string; hex: string; tUs: number }[]
}

/** Bound to one telemetry session. Ascending pages, limited to 20 bootstrap / 100 catch-up rows. */
export interface RawBatchClient {
  fetchPage(options: { afterId: string | null; signal: AbortSignal }): Promise<unknown[]>
}

export interface RawBatchSessionOptions {
  client: RawBatchClient
  sessionId: string
  staleAfterMs: number
  now?: () => number
  /** Numeric or opaque raw channels can accept a newer sample. */
  onAccepted?: (snapshot: RawBatchSnapshot) => void
  /**
   * Lightweight per-sample callback for hot paths (whole-session replays decode
   * hundreds of thousands of frames). `channels` is the live state object: read
   * it synchronously, do not mutate or keep it.
   */
  onSample?: (sample: { channels: ChannelState; sessionStartUs: number; latestSampleUs: number | null }) => void
}

type Listener = (snapshot: RawBatchSnapshot) => void
interface Batch {
  id: bigint
  seq: number
  droppedFrames: number
  frames: unknown[]
  sentAtMs: number
}

const NO_ROWS_WARNING = 'No rows visible for this session. Check that you are signed in and the session ID is right: RLS returns an empty list (not an error) to unauthenticated readers, as can a session with no batches yet.'
const MAX_BATCH_ID = (1n << 63n) - 1n

function parseBatch(raw: unknown, sessionId: string): Batch {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid raw batch: expected an object')
  }
  const row = raw as Record<string, unknown>
  let id: bigint
  if (typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id >= 0) {
    id = BigInt(row.id)
  } else if (typeof row.id === 'string' && /^[0-9]{1,19}$/.test(row.id)) {
    id = BigInt(row.id)
  } else {
    throw new Error('Invalid raw batch: id must be an exact int8 number or decimal string')
  }
  if (id > MAX_BATCH_ID) throw new Error('Invalid raw batch: id exceeds int8 range')
  if (row.session_id !== sessionId) throw new Error('Invalid raw batch: session_id does not match session filter')
  if (typeof row.seq !== 'number' || !Number.isSafeInteger(row.seq) || row.seq < 0) {
    throw new Error('Invalid raw batch: seq must be a safe nonnegative integer')
  }
  if (typeof row.dropped_frames !== 'number' || !Number.isSafeInteger(row.dropped_frames) || row.dropped_frames < 0) {
    throw new Error('Invalid raw batch: dropped_frames must be a safe nonnegative integer')
  }
  if (!Array.isArray(row.frames) || row.frames.length > RAW_MAX_BATCH_FRAMES) {
    throw new Error(`Invalid raw batch: frames must be an array of at most ${RAW_MAX_BATCH_FRAMES} frames`)
  }
  // A timestamp is required to establish safe historical freshness.
  if (typeof row.sent_at !== 'string' || !Number.isFinite(Date.parse(row.sent_at))) {
    throw new Error('Invalid raw batch: sent_at must be a valid timestamp string')
  }
  return { id, seq: row.seq, droppedFrames: row.dropped_frames, frames: row.frames, sentAtMs: Date.parse(row.sent_at) }
}

function orderedFrames(frames: unknown[]): unknown[] {
  return frames.map((frame, index) => {
    const tsMs = frame !== null && typeof frame === 'object' && !Array.isArray(frame)
      ? (frame as Record<string, unknown>).ts_ms : undefined
    return {
      frame,
      index,
      timestampMs: typeof tsMs === 'number' && Number.isSafeInteger(tsMs) && tsMs >= 0 ? tsMs : Infinity,
    }
  }).sort((a, b) => a.timestampMs - b.timestampMs || a.index - b.index).map(({ frame }) => frame)
}

/** Read-only polling session; seq is diagnostic only and may reset on device reboot. */
export class RawBatchSession {
  private readonly options: RawBatchSessionOptions
  private controller: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private cursor: string | null = null
  private status: RawBatchStatus = 'idle'
  private channels: ChannelState = {}
  private rawReadings = new Map<string, { id: string; hex: string; tUs: number }>()
  private diagnostics: RawBatchDiagnostics = { ...RAW_EMPTY_DIAGNOSTICS, groupsSeen: [] }
  private sessionStartUs: number | null = null
  private listeners = new Set<Listener>()

  constructor(options: RawBatchSessionOptions) {
    this.options = { ...options }
  }

  start(): void {
    this.stop()
    this.channels = {}
    this.rawReadings.clear()
    this.cursor = null
    this.sessionStartUs = null
    this.diagnostics = { ...RAW_EMPTY_DIAGNOSTICS, groupsSeen: [] }
    if (!this.options.sessionId.trim() || !Number.isFinite(this.options.staleAfterMs) || this.options.staleAfterMs <= 0) {
      this.status = 'misconfigured'
      this.diagnostics.lastError = 'sessionId must be nonempty and staleAfterMs must be positive'
      this.emit()
      return
    }
    this.controller = new AbortController()
    const generation = this.generation
    this.status = 'connecting'
    this.emit(generation)
    if (this.active(generation)) void this.poll(generation, this.controller!.signal)
  }

  /** No notifications or late promise completions are delivered after stop(). */
  stop(): void {
    this.generation++
    this.controller?.abort()
    this.controller = null
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.status = 'idle'
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => { this.listeners.delete(listener) }
  }

  snapshot(): RawBatchSnapshot {
    return {
      sessionId: this.options.sessionId,
      status: this.status,
      channels: Object.fromEntries(Object.entries(this.channels).map(([id, sample]) => [id, { ...sample }])),
      diagnostics: { ...this.diagnostics, groupsSeen: [...this.diagnostics.groupsSeen] },
      sessionStartUs: this.sessionStartUs,
      rawReadings: [...this.rawReadings.values()].map(reading => ({ ...reading })),
    }
  }

  private active(generation: number): boolean {
    return generation === this.generation && this.controller !== null && !this.controller.signal.aborted
  }

  private fetchPage(afterId: string | null, signal: AbortSignal): Promise<unknown[]> {
    // Abort the actual query, but also settle locally if a client ignores abort.
    // Each request owns its controller/timer, so an expired query cannot cancel a retry.
    return new Promise((resolve, reject) => {
      const request = new AbortController()
      let cleanedUp = false
      const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        reject(new Error('Raw batch fetch aborted'))
        request.abort()
      }
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`Raw batch fetch timed out after ${RAW_FETCH_TIMEOUT_MS}ms`))
        request.abort()
      }, RAW_FETCH_TIMEOUT_MS)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        onAbort()
        return
      }
      try {
        this.options.client.fetchPage({ afterId, signal: request.signal }).then(
          page => { cleanup(); resolve(page) },
          error => { cleanup(); reject(error) },
        )
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

  private async poll(generation: number, signal: AbortSignal): Promise<void> {
    const afterId = this.cursor
    const limit = afterId === null ? RAW_BOOTSTRAP_LIMIT : RAW_PAGE_LIMIT
    let delay = RAW_POLL_INTERVAL_MS
    try {
      const page = await this.fetchPage(afterId, signal)
      if (!this.active(generation)) return
      if (!Array.isArray(page)) throw new Error('Invalid raw batch page: expected an array')
      if (page.length > limit) throw new Error(`Invalid raw batch page: exceeds ${limit}-row limit`)
      // Validate the entire page before changing state/cursor, including duplicate rows.
      const batches = page.map(row => parseBatch(row, this.options.sessionId))
      for (let i = 1; i < batches.length; i++) {
        if (batches[i].id < batches[i - 1].id) throw new Error('Invalid raw batch page: ids must be ascending')
      }
      this.status = 'connected'
      this.diagnostics.lastError = batches.length === 0 && this.diagnostics.receivedBatches === 0 ? NO_ROWS_WARNING : null
      for (const batch of batches) {
        if (!this.active(generation)) return
        if (this.cursor !== null && batch.id <= BigInt(this.cursor)) continue
        this.cursor = batch.id.toString()
        this.diagnostics.receivedBatches++
        this.diagnostics.droppedFrames += batch.droppedFrames
        this.diagnostics.lastBatchId = this.cursor
        this.diagnostics.lastSeq = batch.seq
        for (const frame of orderedFrames(batch.frames)) {
          if (!this.active(generation)) return
          this.handleFrame(frame, batch, generation)
        }
      }
      // A full bootstrap is also followed immediately by an ascending catch-up.
      if (page.length === limit && this.cursor !== afterId) delay = 0
    } catch (error) {
      if (!this.active(generation)) return
      this.status = 'error'
      this.diagnostics.lastError = sanitizeStatusError(error)
    }
    if (!this.active(generation)) return
    this.emit(generation)
    if (!this.active(generation)) return
    // Schedule only after settlement: slow queries never stack up interval requests.
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.active(generation)) void this.poll(generation, signal)
    }, delay)
  }

  private handleFrame(raw: unknown, batch: Batch, generation: number): void {
    const now = this.options.now ? this.options.now() : Date.now()
    this.diagnostics.received++
    this.diagnostics.lastReceiptMs = now
    const decoded = decodeCanFrame(raw)
    if (!decoded.ok || !Number.isSafeInteger(decoded.timestampMs * 1_000)) {
      this.diagnostics.invalid++
      this.diagnostics.lastError = `Invalid raw CAN frame (${decoded.ok ? 'unsafe microsecond timestamp' : decoded.reason})`
      return
    }
    this.diagnostics.decodedFrames++
    this.diagnostics.unknownFrames += decoded.unknown ? 1 : 0
    this.diagnostics.skippedSignals += decoded.skippedSignals
    const tUs = decoded.timestampMs * 1_000
    const receivedAtMs = Math.min(now, batch.sentAtMs)
    // A newer opaque value also owns this channel's timestamp, even if it was
    // too wide to enter numeric state. Do not refresh it with an older number.
    const values = Object.fromEntries(Object.entries(decoded.values).filter(([id]) => {
      const previous = this.rawReadings.get(id)
      if (!previous || tUs > previous.tUs) return true
      this.diagnostics.ignoredOld++
      return false
    }))
    const previousChannels = this.channels
    const merged = mergeChannels(previousChannels, {
      seq: batch.seq,
      // The merge helper consumes values/tUs; diagnostics below use the send time.
      sendTimestampMs: batch.sentAtMs,
      tUs,
      values,
      rejectedValueCount: decoded.skippedSignals,
    }, receivedAtMs)
    this.channels = merged.state
    this.diagnostics.ignoredOld += merged.ignoredOldCount
    this.diagnostics.rejectedValues += merged.rejectedValueCount
    const acceptedIds = new Set(merged.acceptedIds)
    for (const [id, hex] of Object.entries(decoded.rawValues)) {
      const previous = this.rawReadings.get(id)
      const previousNumeric = previousChannels[id]
      if ((previous && tUs <= previous.tUs) || (previousNumeric && tUs <= previousNumeric.tUs)) {
        // Numeric and opaque representations of one channel count only once.
        if (!(id in decoded.values)) this.diagnostics.ignoredOld++
        continue
      }
      this.rawReadings.set(id, { id, hex, tUs })
      if (previousNumeric && !(id in decoded.values)) {
        // The newer sample is real but not representable as a number. Keeping
        // the old numeric value here would mislabel historical data as current.
        this.channels = { ...this.channels }
        delete this.channels[id]
      }
      acceptedIds.add(id)
    }
    if (acceptedIds.size === 0) return
    this.sessionStartUs ??= tUs
    this.diagnostics.accepted++
    this.diagnostics.lastAcceptedMs = Math.max(this.diagnostics.lastAcceptedMs ?? receivedAtMs, receivedAtMs)
    this.diagnostics.latestSampleUs = Math.max(this.diagnostics.latestSampleUs ?? 0, tUs)
    // Estimates include clock skew; upload delay also includes polling, not just network time.
    this.diagnostics.lastSendTimestampMs = batch.sentAtMs
    this.diagnostics.uplinkEstimateMs = now - batch.sentAtMs
    this.diagnostics.sampleAgeEstimateMs = now - decoded.timestampMs
    if (!this.active(generation)) return
    this.options.onSample?.({ channels: this.channels, sessionStartUs: this.sessionStartUs, latestSampleUs: this.diagnostics.latestSampleUs })
    if (this.options.onAccepted) this.options.onAccepted(this.snapshot())
  }

  private emit(generation = this.generation): void {
    for (const listener of this.listeners) {
      if (generation !== this.generation) break
      listener(this.snapshot())
    }
  }
}
