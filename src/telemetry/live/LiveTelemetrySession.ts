import { inferGroup } from './channelSet1'
import { mergeChannels, sessionFreshness } from './mergeChannelState'
import { parseLiveBroadcast } from './parseLiveBroadcast'
import {
  EMPTY_DIAGNOSTICS,
  type ChannelState,
  type DataFreshness,
  type LiveConnectionStatus,
  type LiveDiagnostics,
} from './types'
import { isSessionUuid, sanitizeStatusError, type BroadcastClient } from './broadcastClient'

export interface LiveSessionOptions {
  client: BroadcastClient
  sessionId: string
  staleAfterMs: number
  now?: () => number
  /** Invoked only when at least one channel accepted a newer sample. */
  onAccepted?: (snapshot: LiveSessionSnapshot) => void
}

export interface LiveSessionSnapshot {
  sessionId: string
  status: LiveConnectionStatus
  freshness: DataFreshness
  channels: ChannelState
  diagnostics: LiveDiagnostics
}

type Listener = (snapshot: LiveSessionSnapshot) => void

const LIVE_EVENT = 'live'

/**
 * Isolated broadcast session. One subscription, one channel-state partition.
 * start() always drops the previous listener before adding another.
 * Broadcast is best-effort and is not replayed, so a new subscription starts empty.
 */
export class LiveTelemetrySession {
  private subscription: { unsubscribe: () => void } | null = null
  private channels: ChannelState = {}
  private diagnostics: LiveDiagnostics = { ...EMPTY_DIAGNOSTICS, groupsSeen: [] }
  private status: LiveConnectionStatus = 'idle'
  private listeners = new Set<Listener>()
  private started = false

  constructor(private options: LiveSessionOptions) {}

  start(): void {
    this.stop()
    const sessionId = this.options.sessionId.trim()
    if (!isSessionUuid(sessionId)) {
      this.status = 'misconfigured'
      this.diagnostics = { ...this.diagnostics, lastError: 'session id must be a UUID' }
      this.emit()
      return
    }
    this.started = true
    this.status = 'connecting'
    this.emit()
    this.subscription = this.options.client.subscribe({
      topic: `telemetry:live:${sessionId}`,
      event: LIVE_EVENT,
      isPrivate: false,
      onMessage: payload => this.handle(payload),
      onStatus: (status, error) => {
        if (!this.started) return
        this.status = status
        if (error) this.diagnostics = { ...this.diagnostics, lastError: sanitizeStatusError(error) }
        if (status === 'subscribed') this.diagnostics = { ...this.diagnostics, lastError: null }
        this.emit()
      },
    })
  }

  stop(): void {
    this.started = false
    this.subscription?.unsubscribe()
    this.subscription = null
  }

  /** Drop samples from the previous run. Does not by itself leave the socket. */
  clear(): void {
    this.channels = {}
    this.diagnostics = { ...EMPTY_DIAGNOSTICS, groupsSeen: [] }
    this.emit()
  }

  /**
   * Switch session or client. State is partitioned: values from the previous
   * UUID are discarded before the new subscription can deliver a message.
   */
  replace(options: LiveSessionOptions): void {
    const sessionChanged = options.sessionId.trim() !== this.options.sessionId.trim()
    this.options = options
    if (sessionChanged) this.clear()
    this.start()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => { this.listeners.delete(listener) }
  }

  snapshot(nowMs = this.now()): LiveSessionSnapshot {
    return {
      sessionId: this.options.sessionId.trim(),
      status: this.status,
      freshness: sessionFreshness(this.channels, nowMs, this.options.staleAfterMs),
      channels: this.channels,
      diagnostics: this.diagnostics,
    }
  }

  private handle(payload: unknown): void {
    if (!this.started) return
    const receivedAtMs = this.now()
    const parsed = parseLiveBroadcast(payload)
    if (!parsed.ok) {
      this.diagnostics = {
        ...this.diagnostics,
        received: this.diagnostics.received + 1,
        invalid: this.diagnostics.invalid + 1,
        lastReceiptMs: receivedAtMs,
        lastError: `invalid live message (${parsed.reason})`,
      }
      this.emit()
      return
    }

    const merged = mergeChannels(this.channels, parsed.message, receivedAtMs)
    const group = inferGroup(parsed.message.values)
    const groupsSeen = group === null || this.diagnostics.groupsSeen.includes(group)
      ? this.diagnostics.groupsSeen
      : [...this.diagnostics.groupsSeen, group].sort((a, b) => a - b)
    const accepted = merged.acceptedIds.length > 0
    const latestSampleUs = accepted
      ? Math.max(this.diagnostics.latestSampleUs ?? 0, parsed.message.tUs)
      : this.diagnostics.latestSampleUs

    this.channels = merged.state
    this.diagnostics = {
      ...this.diagnostics,
      received: this.diagnostics.received + 1,
      accepted: this.diagnostics.accepted + (accepted ? 1 : 0),
      ignoredOld: this.diagnostics.ignoredOld + merged.ignoredOldCount,
      rejectedValues: this.diagnostics.rejectedValues + merged.rejectedValueCount,
      lastReceiptMs: receivedAtMs,
      lastAcceptedMs: accepted ? receivedAtMs : this.diagnostics.lastAcceptedMs,
      latestSampleUs,
      lastSendTimestampMs: parsed.message.sendTimestampMs,
      lastSeq: parsed.message.seq,
      uplinkEstimateMs: accepted ? receivedAtMs - parsed.message.sendTimestampMs : this.diagnostics.uplinkEstimateMs,
      sampleAgeEstimateMs: accepted ? receivedAtMs - parsed.message.tUs / 1000 : this.diagnostics.sampleAgeEstimateMs,
      groupsSeen,
      lastError: null,
    }
    const snapshot = this.snapshot(receivedAtMs)
    this.emit(snapshot)
    if (accepted) this.options.onAccepted?.(snapshot)
  }

  private emit(snapshot = this.snapshot()): void {
    for (const listener of this.listeners) listener(snapshot)
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now()
  }
}
