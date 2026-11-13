import { MONO } from '../telemetry/simulation'
import { useTelemetryStatus } from '../state/TelemetryStatusContext'
import { RAW_DASHBOARD_MAPPINGS } from '../telemetry/raw/mapRawToFrame'

const textStyle = { fontFamily: MONO, fontSize: 8, color: '#b6b6b6', lineHeight: 1.6 }
const headingStyle = { ...textStyle, color: '#cccccc', letterSpacing: '0.1em' }

export default function RawSourceDetails() {
  const telemetry = useTelemetryStatus()
  const diag = telemetry?.rawDiagnostics
  return (
    <div className="flex flex-col gap-2 p-2 rounded" style={{ backgroundColor: '#0c0c0c', border: '1px solid #222' }}>
      <span style={headingStyle}>LOCAL CAN PROCESSING</span>
      <span style={textStyle}>Reads telemetry.can_batches for one session. Byte order, signedness, multiplexing, and scaling come from the pinned logger/config.json. No ingest credentials or writes are needed.</span>
      <span style={{ ...textStyle, color: '#e8b65b' }}>Sign-in required: only authenticated users can read can_batches, and RLS returns an empty list (not an error) to anyone else. Never use a service-role key in the browser.</span>
      <span style={headingStyle}>DIAGNOSTICS</span>
      <span style={textStyle}>{diag
        ? `batches ${diag.receivedBatches} · frames ${diag.received} · valid ${diag.decodedFrames} · accepted ${diag.accepted} · unknown ID/mux ${diag.unknownFrames} · invalid ${diag.invalid}`
        : 'Select Supabase to start polling.'}</span>
      {diag && <>
        <span style={textStyle}>{`batch ID ${diag.lastBatchId ?? '—'} · seq ${diag.lastSeq ?? '—'} · transmitter dropped ${diag.droppedFrames} · skipped signals ${diag.skippedSignals} · old samples ${diag.ignoredOld}`}</span>
        <span style={textStyle}>{`last accepted batch ${diag.lastAcceptedMs === null ? '—' : new Date(diag.lastAcceptedMs).toLocaleString()}`}. Historical rows remain stale; fetch time does not make them live.</span>
        <span style={textStyle}>{`Upload-to-client delay estimate ${diag.uplinkEstimateMs === null ? '—' : `${Math.round(diag.uplinkEstimateMs)} ms`}`}. Includes polling and clock skew; server-time fallback does not measure device delay.</span>
        {diag.lastError && <span style={{ ...textStyle, color: '#ff9966' }}>{diag.lastError}</span>}
      </>}
      <span style={headingStyle}>DASHBOARD MAPPINGS</span>
      <span style={textStyle}>{RAW_DASHBOARD_MAPPINGS.map(mapping => `${mapping.field} ← ${mapping.channelId}`).join(' · ')}</span>
      <span style={textStyle}>Pressure units, wheel-speed conversion, IMU axes, and ADC calibration are not established by this config. Those dashboard fields stay unavailable, not zero. ADC readings are not included in these CAN batches. No synthetic laps are generated.</span>
      <span style={textStyle}>Logger temperature offsets are reproduced exactly (scale × (raw − offset)). Confirm their physical meaning on hardware before using temperature alerts operationally.</span>
      <span style={headingStyle}>DECODED CHANNELS</span>
      <div className="flex flex-col gap-1" style={{ maxHeight: 180, overflowY: 'auto' }}>
        {(telemetry?.channelReadings ?? []).map(reading => <span key={reading.id} style={textStyle}>{reading.id} = {reading.value}</span>)}
        {!telemetry?.channelReadings.length && <span style={textStyle}>No configured numeric signals received yet.</span>}
      </div>
      {!!telemetry?.rawReadings.length && <>
        <span style={headingStyle}>UNSCALED SIGNAL BYTES (HEX)</span>
        <div className="flex flex-col gap-1" style={{ maxHeight: 120, overflowY: 'auto' }}>
          {telemetry.rawReadings.map(reading => <span key={reading.id} style={textStyle}>{reading.id} = {reading.hex}</span>)}
        </div>
      </>}
    </div>
  )
}
