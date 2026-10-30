import { useEffect, useRef, useState } from 'react'
import { LiveTelemetrySession, type LiveSessionSnapshot } from './LiveTelemetrySession'
import { channelsToFrame, sessionStartUs, type MappedFrame } from './mapToFrame'
import { createSupabaseBroadcastClient } from './supabaseBroadcast'
import { isPublishableKey, isSessionUuid, normalizeSupabaseUrl, sanitizeStatusError } from './broadcastClient'
import { EMPTY_DIAGNOSTICS, type ChannelState, type DataFreshness, type LiveConnectionStatus, type LiveDiagnostics } from './types'

export interface SupabaseLive {
  enabled: boolean
  status: LiveConnectionStatus
  freshness: DataFreshness
  channels: ChannelState
  diagnostics: LiveDiagnostics
  frame: MappedFrame | null
  sessionId: string
}

const IDLE: SupabaseLive = {
  enabled: false,
  status: 'idle',
  freshness: 'no-data',
  channels: {},
  diagnostics: EMPTY_DIAGNOSTICS,
  frame: null,
  sessionId: '',
}

export function useSupabaseLive(options: {
  enabled: boolean
  url: string
  anonKey: string
  sessionId: string
  staleAfterMs: number
  onAccepted?: (frame: MappedFrame) => void
}): SupabaseLive {
  const [live, setLive] = useState<SupabaseLive>(IDLE)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const staleRef = useRef(options.staleAfterMs)
  staleRef.current = options.staleAfterMs

  useEffect(() => {
    if (!options.enabled) {
      setLive(IDLE)
      return
    }

    let stopped = false
    let session: LiveTelemetrySession | null = null
    const onAccepted = options.onAccepted

    const apply = (snapshot: LiveSessionSnapshot) => {
      const start = sessionStartUs(snapshot.channels)
      setLive({
        enabled: true,
        status: snapshot.status,
        freshness: snapshot.freshness,
        channels: snapshot.channels,
        diagnostics: snapshot.diagnostics,
        frame: Object.keys(snapshot.channels).length ? channelsToFrame(snapshot.channels, start) : null,
        sessionId: snapshot.sessionId,
      })
    }

    try {
      const url = normalizeSupabaseUrl(options.url)
      const sessionId = options.sessionId.trim()
      if (!url || !isPublishableKey(options.anonKey) || !isSessionUuid(sessionId)) {
        setLive({
          ...IDLE,
          enabled: true,
          status: 'misconfigured',
          sessionId,
          diagnostics: { ...EMPTY_DIAGNOSTICS, lastError: configError(options.url, options.anonKey, sessionId) },
        })
        return
      }
      const client = createSupabaseBroadcastClient(url, options.anonKey)
      session = new LiveTelemetrySession({
        client,
        sessionId,
        staleAfterMs: staleRef.current,
        onAccepted: snapshot => {
          if (stopped || !onAccepted) return
          onAccepted(channelsToFrame(snapshot.channels, sessionStartUs(snapshot.channels)))
        },
      })
      const unsubscribe = session.subscribe(snapshot => {
        if (!stopped) apply(snapshot)
      })
      session.start()
      const tick = window.setInterval(() => setNowMs(Date.now()), 500)
      return () => {
        stopped = true
        unsubscribe()
        session?.stop()
        window.clearInterval(tick)
      }
    } catch (err) {
      setLive({
        ...IDLE,
        enabled: true,
        status: 'error',
        diagnostics: { ...EMPTY_DIAGNOSTICS, lastError: sanitizeStatusError(err) },
      })
      return () => { stopped = true }
    }
    // onAccepted is captured for this subscription. Callers should keep it stable
    // or accept a resubscribe when its identity changes.
    // staleAfterMs is read from a ref so a threshold edit does not resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enabled, options.url, options.anonKey, options.sessionId])

  if (!options.enabled) return IDLE
  if (live.diagnostics.lastAcceptedMs === null) return live
  const age = nowMs - live.diagnostics.lastAcceptedMs
  const freshness: DataFreshness = age > options.staleAfterMs ? 'stale' : 'fresh'
  return freshness === live.freshness ? live : { ...live, freshness }
}

function configError(url: string, key: string, sessionId: string): string {
  if (!normalizeSupabaseUrl(url)) return 'supabase url must be an http(s) project origin'
  if (!isPublishableKey(key)) return 'supabase key must be a publishable or anon key, not a secret or service-role key'
  if (!isSessionUuid(sessionId)) return 'session id must be a UUID'
  return 'supabase broadcast is not configured'
}
