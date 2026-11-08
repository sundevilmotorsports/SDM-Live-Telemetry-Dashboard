import { useEffect, useRef, useState } from 'react'
import { isPublishableKey, normalizeSupabaseUrl, sanitizeStatusError } from '../live/broadcastClient'
import type { ChannelState, DataFreshness } from '../live/types'
import type { MappedFrame } from '../live/mapToFrame'
import { RawBatchSession, RAW_EMPTY_DIAGNOSTICS, type RawBatchSnapshot } from './RawBatchSession'
import { createSupabaseBatchClient } from './supabaseBatches'
import { rawChannelsToFrame } from './mapRawToFrame'

export interface SupabaseRaw extends RawBatchSnapshot {
  freshness: DataFreshness
  frame: MappedFrame | null
}

const IDLE: SupabaseRaw = {
  sessionId: '', status: 'idle', channels: {}, diagnostics: RAW_EMPTY_DIAGNOSTICS,
  sessionStartUs: null, rawReadings: [], freshness: 'no-data', frame: null,
}

export function useSupabaseRaw(options: {
  enabled: boolean
  url: string
  anonKey: string
  sessionId: string
  /** Raw reads need a signed-in user: RLS returns an empty list, not an error, otherwise. */
  signedIn: boolean
  staleAfterMs: number
  onAccepted?: (frame: MappedFrame) => void
  /** Called for every accepted CAN frame with the live channel state (not resampled). */
  onChannels?: (channels: ChannelState) => void
}): SupabaseRaw {
  const [snapshot, setSnapshot] = useState<SupabaseRaw>(IDLE)
  const [nowMs, setNowMs] = useState(Date.now)
  const onAccepted = useRef(options.onAccepted)
  onAccepted.current = options.onAccepted
  const onChannels = useRef(options.onChannels)
  onChannels.current = options.onChannels
  const staleAfter = useRef(options.staleAfterMs)
  staleAfter.current = options.staleAfterMs

  useEffect(() => {
    if (!options.enabled) {
      setSnapshot(IDLE)
      return
    }
    let stopped = false
    let session: RawBatchSession | null = null
    const sessionId = options.sessionId.trim()
    const url = normalizeSupabaseUrl(options.url)
    const configError = !url ? 'Supabase URL must be an http(s) project origin.'
      : !isPublishableKey(options.anonKey) ? 'Use a publishable or anon key, never a service-role or secret key.'
      : !options.signedIn ? 'Sign in to read raw CAN batches.'
      : !sessionId ? 'Start a session or pick a past one.'
      : null
    if (configError) {
      setSnapshot({ ...IDLE, sessionId, status: 'misconfigured', diagnostics: { ...RAW_EMPTY_DIAGNOSTICS, lastError: configError } })
      return
    }
    try {
      session = new RawBatchSession({
        client: createSupabaseBatchClient(url!, options.anonKey, sessionId),
        sessionId,
        staleAfterMs: staleAfter.current,
        onSample: next => {
          if (stopped) return
          onChannels.current?.(next.channels)
          onAccepted.current?.(rawChannelsToFrame(next.channels, next.sessionStartUs, next.latestSampleUs))
        },
      })
      const unsubscribe = session.subscribe(next => {
        if (stopped) return
        setNowMs(Date.now())
        setSnapshot({
          ...next,
          freshness: 'no-data',
          frame: next.sessionStartUs === null ? null : rawChannelsToFrame(next.channels, next.sessionStartUs, next.diagnostics.latestSampleUs),
        })
      })
      session.start()
      const tick = window.setInterval(() => setNowMs(Date.now()), 500)
      return () => {
        stopped = true
        unsubscribe()
        session?.stop()
        window.clearInterval(tick)
      }
    } catch (error) {
      session?.stop()
      setSnapshot({ ...IDLE, sessionId, status: 'error', diagnostics: { ...RAW_EMPTY_DIAGNOSTICS, lastError: sanitizeStatusError(error) } })
      return () => { stopped = true }
    }
  }, [options.enabled, options.url, options.anonKey, options.sessionId, options.signedIn])

  if (!options.enabled) return IDLE
  const acceptedAt = snapshot.diagnostics.lastAcceptedMs
  const freshness: DataFreshness = acceptedAt === null ? 'no-data'
    : nowMs - acceptedAt > options.staleAfterMs ? 'stale' : 'fresh'
  return { ...snapshot, freshness }
}
