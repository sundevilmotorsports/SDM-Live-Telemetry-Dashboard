import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useConfig } from './ConfigContext'
import type { Telemetry } from '../telemetry/useTelemetry'
import { buildChannelRows } from '../telemetry/channelAvailability'
import { evalExpr, exprIdentifiers, isValidExpr } from '../telemetry/expression'
import { frameScope } from '../telemetry/simulation'
import { RestZeroer, type Baselines } from '../telemetry/zeroing'

export type RestState = 'moving' | 'at-rest' | 'unavailable' | 'invalid'

export interface Zeroing {
  baselines: Baselines
  rest: RestState
  /** Seconds the car has been at rest (session time), when at rest. */
  restForS: number | null
  /** Session time of the newest frame, for looking up the baseline in effect now. */
  nowT: number
  zeroNow: (key: string) => void
  clear: (key: string) => void
}

const EMPTY: Zeroing = { baselines: {}, rest: 'unavailable', restForS: null, nowT: NaN, zeroNow: () => {}, clear: () => {} }
const ZeroingCtx = createContext<Zeroing>(EMPTY)

/** Evaluates the rest condition on each new frame and captures baselines for enabled channels. */
export function ZeroingProvider({ telemetry, children }: { telemetry: Telemetry; children: ReactNode }) {
  const { autoZero, restCondition, restHoldS, telemetrySource, supabaseMode } = useConfig()
  const zeroer = useRef(new RestZeroer())
  const [baselines, setBaselines] = useState<Baselines>({})
  const [rest, setRest] = useState<{ state: RestState; forS: number | null }>({ state: 'unavailable', forS: null })
  const latest = telemetry.frames[telemetry.frames.length - 1]
  const t = latest?.t ?? NaN

  const rowsRef = useRef<Record<string, number>>({})
  rowsRef.current = Object.fromEntries(buildChannelRows({
    source: telemetrySource, mode: supabaseMode, stats: telemetry.channelStats, latest,
    connected: telemetry.connectionStatus === 'connected', packetRate: telemetry.packetRate,
  }).map(r => [r.key, r.value]))

  // A new stream/session starts with no baselines: readings are as-is until the first stop.
  useEffect(() => {
    zeroer.current.reset()
    setBaselines({})
  }, [telemetry.streamKey])

  useEffect(() => {
    if (!latest) return
    let state: RestState
    let atRest = false
    if (!isValidExpr(restCondition)) state = 'invalid'
    else {
      const scope = frameScope(latest)
      const inputs = exprIdentifiers(restCondition)
      if (inputs.some(name => !Number.isFinite(scope[name]))) state = 'unavailable'
      else {
        atRest = evalExpr(restCondition, scope) !== 0
        state = atRest ? 'at-rest' : 'moving'
      }
    }
    if (zeroer.current.update(latest.t, atRest, rowsRef.current, autoZero, restHoldS)) setBaselines(zeroer.current.baselines)
    const start = zeroer.current.restStartedAt
    setRest(prev => {
      const forS = atRest && start !== null ? latest.t - start : null
      return prev.state === state && prev.forS === forS ? prev : { state, forS }
    })
  }, [latest, restCondition, autoZero, restHoldS])

  const value: Zeroing = {
    baselines, rest: rest.state, restForS: rest.forS, nowT: t,
    zeroNow: key => { if (zeroer.current.zeroNow(t, rowsRef.current, [key])) setBaselines(zeroer.current.baselines) },
    clear: key => { if (zeroer.current.clear(key)) setBaselines(zeroer.current.baselines) },
  }
  return <ZeroingCtx.Provider value={value}>{children}</ZeroingCtx.Provider>
}

export function useZeroing(): Zeroing {
  return useContext(ZeroingCtx)
}
