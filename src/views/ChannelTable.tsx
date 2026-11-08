import { useMemo } from 'react'
import { MONO } from '../telemetry/simulation'
import { useConfig } from '../state/ConfigContext'
import type { Telemetry } from '../telemetry/useTelemetry'
import { buildChannelRows, recentRawReadings } from '../telemetry/channelAvailability'
import { convertValue, decimalsFor, resolveUnit, unitOptions } from '../telemetry/units'
import { useZeroing, type RestState } from '../state/ZeroingContext'
import { baselineAt, deltaUnit, zeroedValue } from '../telemetry/zeroing'
import { isValidExpr } from '../telemetry/expression'

const cell = { fontFamily: MONO, fontSize: 10, padding: '0 12px', height: 24, whiteSpace: 'nowrap' as const }
const head = { ...cell, fontSize: 8, letterSpacing: '0.18em', color: '#989898', textAlign: 'left' as const, position: 'sticky' as const, top: 0, background: '#141414', borderBottom: '1px solid #242424' }

function fmtRate(hz: number | null): string {
  if (hz === null) return '—'
  return `${hz < 10 ? hz.toFixed(1) : Math.round(hz)} Hz`
}

function fmtValue(value: number, unitLabel: string): string {
  if (!Number.isFinite(value)) return '—'
  if (Number.isInteger(value)) return String(value)
  const abs = Math.abs(value)
  return value.toFixed(Math.max(decimalsFor(unitLabel), abs >= 100 ? 0 : abs >= 10 ? 1 : 2))
}

const REST_LABEL: Record<RestState, { text: string; color: string }> = {
  'at-rest': { text: 'AT REST', color: '#00ff41' },
  moving: { text: 'MOVING', color: '#4488ff' },
  unavailable: { text: 'CONDITION INPUTS UNAVAILABLE', color: '#ffaa00' },
  invalid: { text: 'INVALID CONDITION', color: '#ff3333' },
}

const smallBtn = { fontFamily: MONO, fontSize: 8, letterSpacing: '0.1em', background: 'none', border: '1px solid #2a2a2a', borderRadius: 3, color: '#aeaeae', padding: '1px 6px', cursor: 'pointer' }

/** Every channel currently receiving data, with a unit switcher and the measured sample rate. */
export function ChannelTable({ telemetry }: { telemetry: Telemetry }) {
  const { unitPrefs, setUnitPref, telemetrySource, supabaseMode, staleAfterMs, autoZero, setAutoZero, restCondition, setRestCondition, restHoldS, setRestHoldS } = useConfig()
  const zeroing = useZeroing()
  const rest = REST_LABEL[zeroing.rest]
  const frames = telemetry.frames
  const latest = frames[frames.length - 1]
  const rows = useMemo(() => buildChannelRows({
    source: telemetrySource, mode: supabaseMode, stats: telemetry.channelStats, latest,
    connected: telemetry.connectionStatus === 'connected', packetRate: telemetry.packetRate,
    opaque: recentRawReadings(telemetry.rawReadings, telemetry.rawDiagnostics?.latestSampleUs, staleAfterMs, telemetry.freshness === 'fresh'),
  }), [telemetrySource, supabaseMode, telemetry.channelStats, latest, telemetry.connectionStatus, telemetry.packetRate, telemetry.rawReadings, telemetry.rawDiagnostics, staleAfterMs, telemetry.freshness])

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-[#171717]">
      <div className="flex items-center justify-between px-3 border-b border-[#1e1e1e]" style={{ height: 22, flexShrink: 0 }}>
        <span style={{ fontFamily: MONO, fontSize: 8, color: '#989898', letterSpacing: '0.2em' }}>CHANNELS RECEIVING DATA · {rows.length}</span>
        <span style={{ fontFamily: MONO, fontSize: 7.5, color: '#919191' }}>
          Unit choice applies across the dashboard (gauges, charts, readouts). Rates are measured from device timestamps.
        </span>
      </div>
      <div className="flex items-center gap-2 px-3 border-b border-[#1e1e1e]" style={{ height: 26, flexShrink: 0, fontFamily: MONO, fontSize: 8.5, color: '#9f9f9f' }}
        title="While this holds for the set time (e.g. in the pit), each AUTO-ZERO channel's reading becomes its new zero until the next stop. Display only: stored data, alerts, and math use raw values.">
        <span style={{ letterSpacing: '0.15em' }}>AUTO-ZERO WHEN AT REST:</span>
        <input value={restCondition} onChange={e => setRestCondition(e.target.value)} spellCheck={false} aria-label="Rest condition"
          style={{ fontFamily: MONO, fontSize: 9, background: '#101010', color: isValidExpr(restCondition) ? '#cccccc' : '#ff3333', border: '1px solid #2a2a2a', borderRadius: 3, padding: '1px 6px', width: 160 }} />
        <span>FOR</span>
        <input type="number" min={0} step={0.5} value={restHoldS} aria-label="Seconds at rest before zeroing"
          onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) setRestHoldS(v) }}
          style={{ fontFamily: MONO, fontSize: 9, background: '#101010', color: '#cccccc', border: '1px solid #2a2a2a', borderRadius: 3, padding: '1px 4px', width: 48 }} />
        <span>S</span>
        <span style={{ marginLeft: 8, color: rest.color, letterSpacing: '0.12em' }}>
          ● {rest.text}{zeroing.rest === 'at-rest' && zeroing.restForS !== null ? ` · ${zeroing.restForS.toFixed(1)} S` : ''}
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={head}>GROUP</th>
              <th style={head}>CHANNEL</th>
              <th style={head}>SOURCE ID</th>
              <th style={{ ...head, textAlign: 'right' }}>VALUE</th>
              <th style={head}>UNIT</th>
              <th style={{ ...head, textAlign: 'right' }}>SAMPLE RATE</th>
              <th style={{ ...head, textAlign: 'center' }} title="Re-zero this channel when the car is at rest">AUTO-ZERO</th>
              <th style={{ ...head, textAlign: 'right' }}>BASELINE</th>
              <th style={head} />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const options = unitOptions(row.baseUnit)
              const unit = resolveUnit(row.baseUnit, unitPrefs[row.key])
              const segments = zeroing.baselines[row.key]
              const z = zeroedValue(row.value, segments, zeroing.nowT)
              const value = convertValue(z.value, z.zeroed ? deltaUnit(unit) : unit)
              const baseline = baselineAt(segments, zeroing.nowT)
              return (
                <tr key={row.sourceId} className="hover:bg-[#1c1c1c]" style={{ borderBottom: '1px solid #1c1c1c' }}>
                  <td style={{ ...cell, color: '#9f9f9f' }}>{row.group}</td>
                  <td style={{ ...cell, color: '#fff' }}>{row.label}</td>
                  <td style={{ ...cell, color: '#989898' }}>{row.sourceId}</td>
                  <td style={{ ...cell, textAlign: 'right', color: z.zeroed ? '#c88bff' : '#e0e0e0' }} title={row.hex !== undefined ? 'Raw bytes (no numeric layout in config.json yet)' : z.zeroed ? 'Relative to the baseline' : undefined}>{row.hex !== undefined ? <span style={{ color: '#aeaeae' }}>0x{row.hex.toUpperCase()}</span> : <>{z.zeroed && value > 0 ? '+' : ''}{fmtValue(value, unit.label)}</>}</td>
                  <td style={{ ...cell, padding: '0 8px' }}>
                    {options.length > 0 ? (
                      <select value={unit.label} aria-label={`Unit for ${row.label}`}
                        onChange={e => setUnitPref(row.key, e.target.value === row.baseUnit ? null : e.target.value)}
                        style={{ fontFamily: MONO, fontSize: 10, background: '#101010', color: '#bdbdbd', border: '1px solid #2a2a2a', borderRadius: 3, padding: '1px 4px' }}>
                        {options.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: '#989898', padding: '0 4px' }}>{row.baseUnit || '—'}</span>
                    )}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', color: '#aeaeae' }}>{fmtRate(row.rateHz)}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <input type="checkbox" checked={autoZero.includes(row.key)} onChange={e => setAutoZero(row.key, e.target.checked)} aria-label={`Auto-zero ${row.label}`} />
                  </td>
                  <td style={{ ...cell, textAlign: 'right', color: baseline === null ? '#919191' : '#c88bff' }}>
                    {baseline === null ? '—' : fmtValue(convertValue(baseline, unit), unit.label)}
                  </td>
                  <td style={{ ...cell, padding: '0 8px' }}>
                    <span className="flex gap-1">
                      <button style={smallBtn} title="Use the current reading as zero from now on" onClick={() => zeroing.zeroNow(row.key)}>ZERO NOW</button>
                      {segments && <button style={smallBtn} title="Forget baselines: show raw values for the whole session" onClick={() => zeroing.clear(row.key)}>CLEAR</button>}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="flex items-center justify-center" style={{ height: 120, fontFamily: MONO, fontSize: 9, color: '#919191', letterSpacing: '0.15em' }}>
            NO CHANNELS RECEIVING DATA
          </div>
        )}
      </div>
    </div>
  )
}
