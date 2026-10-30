import { createContext, useContext, ReactNode } from 'react'
import type { Telemetry } from '../telemetry/useTelemetry'

const TelemetryStatusCtx = createContext<Telemetry | null>(null)

export function TelemetryStatusProvider({ value, children }: { value: Telemetry; children: ReactNode }) {
  return <TelemetryStatusCtx.Provider value={value}>{children}</TelemetryStatusCtx.Provider>
}

export function useTelemetryStatus(): Telemetry | null {
  return useContext(TelemetryStatusCtx)
}
