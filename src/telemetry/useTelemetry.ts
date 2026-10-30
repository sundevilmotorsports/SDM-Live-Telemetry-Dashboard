import { useEffect, useRef, useState, startTransition } from 'react'
import {
  BUFFER, HZ, LAP_LEN, Frame, makeFrame, seeded, SECTOR_BOUNDS, CHANNELS, CHANNEL_MAP,
} from './simulation'
import { useConfig, TelemetrySource } from '../state/ConfigContext'
import { useSupabaseLive } from './live/useSupabaseLive'
import type { DataFreshness, LiveDiagnostics } from './live/types'
import { EMPTY_DIAGNOSTICS } from './live/types'
import type { MappedFrame } from './live/mapToFrame'

const KPI = ['speed', 'rpm', 'throttle', 'brake']

export type ConnectionStatus =
  | 'simulated'
  | 'connecting'
  | 'connected'
  | 'subscribed'
  | 'reconnecting'
  | 'disconnected'
  | 'error'
  | 'misconfigured'

export interface Lap {
  num: number
  s1: number; s2: number; s3: number
  total: number
  avg: Record<string, number>
  sectorAvg: Record<string, number>[]  // [sector0, sector1, sector2]
  valid: boolean
}

export interface Telemetry {
  frames: Frame[]
  laps: Lap[]
  bestLap: Lap | null
  bestSectors: [number, number, number]
  theoretical: number
  connectionStatus: ConnectionStatus
  packetRate: number
  source: TelemetrySource
  freshness: DataFreshness
  diagnostics: LiveDiagnostics | null
  unavailableFields: string[]
  unmappedChannels: string[]
  /** Latest accepted sample per channel id, including channels with no dashboard field. */
  channelReadings: { id: string; value: number; tUs: number; receivedAtMs: number }[]
}

function sectorOf(lapFrac: number): number {
  if (lapFrac < SECTOR_BOUNDS[0]) return 0
  if (lapFrac < SECTOR_BOUNDS[1]) return 1
  return 2
}

// Base (noiseless) sector durations from the boundary fractions
const BASE_S = [
  SECTOR_BOUNDS[0] * LAP_LEN,
  (SECTOR_BOUNDS[1] - SECTOR_BOUNDS[0]) * LAP_LEN,
  (1 - SECTOR_BOUNDS[1]) * LAP_LEN,
]

function noisySector(lapNum: number, sector: number) {
  return BASE_S[sector] + seeded(lapNum + 1, sector + 1) * 0.9
}

function syntheticLap(num: number): Lap {
  const s = [0, 1, 2].map(i => noisySector(num, i)) as [number, number, number]
  const avg: Record<string, number> = {}
  const sectorAvg = [0, 1, 2].map(sec => {
    const o: Record<string, number> = {}
    for (const k of KPI) {
      const base = k === 'speed' ? 128 : k === 'rpm' ? 6100 : k === 'throttle' ? 62 : 41
      o[k] = base * (1 + seeded(num * 3 + sec, k.length) * 0.06)
    }
    return o
  })
  for (const k of KPI) avg[k] = (sectorAvg[0][k] + sectorAvg[1][k] + sectorAvg[2][k]) / 3
  return { num, s1: s[0], s2: s[1], s3: s[2], total: s[0] + s[1] + s[2], avg, sectorAvg, valid: true }
}

function normalizePacket(raw: any, fallbackT: number): Frame {
  const t = typeof raw.t === 'number' ? raw.t : fallbackT
  const spd = Number(raw.speed ?? raw.spd ?? 0)
  return {
    t,
    speed: spd,
    rpm: Number(raw.rpm ?? 0),
    gear: Number(raw.gear ?? 1),
    throttle: Number(raw.throttle ?? 0),
    brake: Number(raw.brake ?? 0),
    steering: Number(raw.steering ?? 0),
    wFL: Number(raw.wFL ?? spd),
    wFR: Number(raw.wFR ?? spd),
    wRL: Number(raw.wRL ?? spd),
    wRR: Number(raw.wRR ?? spd),
    volt: Number(raw.volt ?? 13.5),
    coolant: Number(raw.coolant ?? 85.0),
    oilTemp: Number(raw.oilTemp ?? 92.0),
    oilPress: Number(raw.oilPress ?? 4.2),
    fuel: Number(raw.fuel ?? 100.0),
    gX: Number(raw.gX ?? 0),
    gY: Number(raw.gY ?? 0),
    lapTime: Number(raw.lapTime ?? (t % LAP_LEN)),
    lapNum: Number(raw.lapNum ?? (Math.floor(t / LAP_LEN) + 1)),
    suspFL: Number(raw.suspFL ?? 0),
    suspFR: Number(raw.suspFR ?? 0),
    suspRL: Number(raw.suspRL ?? 0),
    suspRR: Number(raw.suspRR ?? 0),
  }
}

export function useTelemetry(): Telemetry {
  const { telemetrySource, wsUrl, supabaseUrl, supabaseAnonKey, telemetrySessionId, staleAfterMs } = useConfig()
  // Session/url edits only reset the frame buffer while that source is active.
  const livePartition = telemetrySource === 'supabase' ? `${supabaseUrl}\n${telemetrySessionId}` : ''
  const bufRef = useRef<Frame[]>([])
  const tRef = useRef(0)
  const onFrameRef = useRef<(frame: Frame) => void>(() => {})
  const live = useSupabaseLive({
    enabled: telemetrySource === 'supabase',
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    sessionId: telemetrySessionId,
    staleAfterMs,
    onAccepted: mapped => onFrameRef.current(mapped.frame),
  })
  const [, setTick] = useState(0)
  const [laps, setLaps] = useState<Lap[]>([])
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    telemetrySource === 'simulation' ? 'simulated' : 'connecting'
  )
  const [packetRate, setPacketRate] = useState<number>(HZ)
  const packetCountRef = useRef(0)
  const lastRateTimeRef = useRef(Date.now())

  // lap engine state
  const lapNumRef = useRef(1)
  const sectorRef = useRef(0)
  const sectorStartRef = useRef(0)
  const sectorTimesRef = useRef<number[]>([0, 0, 0])
  const lapAccRef = useRef<{ sum: Record<string, number>; n: number }>({ sum: {}, n: 0 })
  const secAccRef = useRef<{ sum: Record<string, number>; n: number }[]>([])

  const resetAcc = () => ({ sum: Object.fromEntries(CHANNELS.map(c => [c.id, 0])), n: 0 })

  useEffect(() => {
    const accumulate = (f: Frame) => {
      const lap = lapAccRef.current
      const sec = secAccRef.current[sectorRef.current]
      for (const c of CHANNELS) {
        const v = c.get(f)
        lap.sum[c.id] += v
        if (sec) sec.sum[c.id] += v
      }
      lap.n++
      if (sec) sec.n++
    }

    const finalizeLap = (f: Frame) => {
      const num = lapNumRef.current
      const s = sectorTimesRef.current
      const total = s[0] + s[1] + s[2]
      const lapAcc = lapAccRef.current
      const avg: Record<string, number> = {}
      for (const c of CHANNELS) avg[c.id] = lapAcc.n ? lapAcc.sum[c.id] / lapAcc.n : 0
      const sectorAvg = secAccRef.current.map(a => {
        const o: Record<string, number> = {}
        for (const c of CHANNELS) o[c.id] = a.n ? a.sum[c.id] / a.n : 0
        return o
      })
      const lap: Lap = { num, s1: s[0], s2: s[1], s3: s[2], total, avg, sectorAvg, valid: true }
      setLaps(prev => [...prev, lap].slice(-40))
      lapAccRef.current = resetAcc()
      secAccRef.current = [resetAcc(), resetAcc(), resetAcc()]
      sectorTimesRef.current = [0, 0, 0]
    }

    const ingestFrame = (f: Frame) => {
      if (bufRef.current.length >= BUFFER) bufRef.current.shift()
      bufRef.current.push(f)

      const newSector = sectorOf(f.lapTime / LAP_LEN)
      if (f.lapNum !== lapNumRef.current) {
        sectorTimesRef.current[2] = noisySector(lapNumRef.current, 2)
        finalizeLap(f)
        lapNumRef.current = f.lapNum
        sectorRef.current = 0
        sectorStartRef.current = f.t
      } else if (newSector > sectorRef.current) {
        sectorTimesRef.current[sectorRef.current] = noisySector(lapNumRef.current, sectorRef.current)
        sectorRef.current = newSector
        sectorStartRef.current = f.t
      }
      accumulate(f)
      startTransition(() => setTick(n => n + 1))
    }

    onFrameRef.current = (f: Frame) => {
      if (telemetrySource !== 'supabase') return
      if (bufRef.current.length >= BUFFER) bufRef.current.shift()
      bufRef.current.push(f)
      packetCountRef.current++
      const now = Date.now()
      if (now - lastRateTimeRef.current >= 1000) {
        const deltaSec = (now - lastRateTimeRef.current) / 1000
        setPacketRate(Math.round(packetCountRef.current / deltaSec))
        packetCountRef.current = 0
        lastRateTimeRef.current = now
      }
      startTransition(() => setTick(n => n + 1))
    }

    if (telemetrySource === 'simulation') {
      // Always reseed. A previous live buffer can contain NaN for unmapped fields,
      // which must not be mixed into the synthetic stream.
      bufRef.current = []
      for (let i = 0; i < BUFFER; i++) bufRef.current.push(makeFrame(i / HZ))
      tRef.current = BUFFER / HZ
      const cur0 = bufRef.current[bufRef.current.length - 1]
      lapNumRef.current = cur0.lapNum
      sectorRef.current = sectorOf(cur0.lapTime / LAP_LEN)
      sectorStartRef.current = cur0.t - cur0.lapTime + sectorRef.current * BASE_S[0]
      lapAccRef.current = resetAcc()
      secAccRef.current = [resetAcc(), resetAcc(), resetAcc()]

      const seedLaps = Array.from({ length: Math.min(cur0.lapNum - 1, 6) }, (_, i) => syntheticLap(cur0.lapNum - (Math.min(cur0.lapNum - 1, 6)) + i))
      if (seedLaps.length) setLaps(seedLaps)

      setConnectionStatus('simulated')
      setPacketRate(HZ)
      startTransition(() => setTick(n => n + 1))

      const id = setInterval(() => {
        tRef.current += 1 / HZ
        const f = makeFrame(tRef.current)
        ingestFrame(f)
      }, 1000 / HZ)
      return () => clearInterval(id)
    }

    // Live sources start empty. Broadcast is not replayed, and a session change
    // must not keep samples from the previous run.
    bufRef.current = []
    tRef.current = 0
    setLaps([])
    setPacketRate(0)
    packetCountRef.current = 0
    lastRateTimeRef.current = Date.now()
    lapNumRef.current = 1
    sectorRef.current = 0
    sectorStartRef.current = 0
    lapAccRef.current = resetAcc()
    secAccRef.current = [resetAcc(), resetAcc(), resetAcc()]
    startTransition(() => setTick(n => n + 1))

    if (telemetrySource === 'supabase') return

    // ── Live WebSocket Mode ───────────────────────────────────────────────
    let ws: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let isMounted = true

    const connect = () => {
      if (!isMounted) return
      setConnectionStatus('connecting')

      try {
        ws = new WebSocket(wsUrl)
      } catch {
        setConnectionStatus('disconnected')
        reconnectTimeout = setTimeout(connect, 2000)
        return
      }

      ws.onopen = () => {
        if (!isMounted) return
        setConnectionStatus('connected')
        packetCountRef.current = 0
        lastRateTimeRef.current = Date.now()
      }

      ws.onmessage = (evt) => {
        if (!isMounted) return
        try {
          const raw = JSON.parse(evt.data)
          if (raw.type === 'handshake') return // server greeting
          tRef.current += 1 / HZ
          const f = normalizePacket(raw, tRef.current)
          ingestFrame(f)

          // Rate tracking
          packetCountRef.current++
          const now = Date.now()
          if (now - lastRateTimeRef.current >= 1000) {
            const deltaSec = (now - lastRateTimeRef.current) / 1000
            setPacketRate(Math.round(packetCountRef.current / deltaSec))
            packetCountRef.current = 0
            lastRateTimeRef.current = now
          }
        } catch {
          // ignore malformed frame
        }
      }

      ws.onerror = () => {
        if (!isMounted) return
        setConnectionStatus('disconnected')
      }

      ws.onclose = () => {
        if (!isMounted) return
        setConnectionStatus('disconnected')
        reconnectTimeout = setTimeout(connect, 2500)
      }
    }

    connect()

    return () => {
      isMounted = false
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        ws.close()
      }
    }
  }, [telemetrySource, wsUrl, livePartition])

  useEffect(() => {
    if (telemetrySource !== 'supabase') return
    setConnectionStatus(liveStatus(live.status))
  }, [telemetrySource, live.status])

  const bestLap = laps.reduce<Lap | null>((b, l) => (l.valid && (!b || l.total < b.total) ? l : b), null)
  const bestSectors: [number, number, number] = [0, 1, 2].map(i => {
    const vals = laps.filter(l => l.valid).map(l => [l.s1, l.s2, l.s3][i])
    return vals.length ? Math.min(...vals) : NaN
  }) as [number, number, number]
  const theoretical = bestSectors.every(isFinite) ? bestSectors[0] + bestSectors[1] + bestSectors[2] : NaN

  const supabase = telemetrySource === 'supabase'
  const mapped: MappedFrame | null = supabase ? live.frame : null

  return {
    frames: bufRef.current,
    laps,
    bestLap,
    bestSectors,
    theoretical,
    connectionStatus,
    packetRate,
    source: telemetrySource,
    freshness: supabase ? live.freshness : 'fresh',
    diagnostics: supabase ? live.diagnostics : null,
    unavailableFields: mapped?.unavailableFields ?? [],
    unmappedChannels: mapped?.unmappedChannels ?? [],
    channelReadings: supabase
      ? Object.entries(live.channels).map(([id, sample]) => ({ id, value: sample.value, tUs: sample.tUs, receivedAtMs: sample.receivedAtMs }))
      : [],
  }
}

function liveStatus(status: string): ConnectionStatus {
  switch (status) {
    case 'subscribed': return 'subscribed'
    case 'reconnecting': return 'reconnecting'
    case 'disconnected': return 'disconnected'
    case 'error': return 'error'
    case 'misconfigured': return 'misconfigured'
    case 'idle':
    case 'connecting':
    default: return 'connecting'
  }
}

export { CHANNEL_MAP, EMPTY_DIAGNOSTICS }
