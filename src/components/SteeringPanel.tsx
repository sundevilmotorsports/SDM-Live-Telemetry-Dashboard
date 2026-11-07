import { MONO, type Frame } from '../telemetry/simulation'
import { LegendWarnings } from './TelemetryAlerts'

export default function SteeringPanel({ frames }: { frames: Frame[] }) {
  const angle = frames[frames.length - 1]?.steering
  const available = Number.isFinite(angle)
  const color = available ? '#ffff00' : '#555'
  const readout = available ? `${angle > 0 ? '+' : ''}${angle.toFixed(1)}°` : '—'

  return (
    <div className="flex flex-col h-full bg-[#171717] border-t border-[#222]">
      <div className="panel-drag flex items-center gap-2 px-3 border-b border-[#222] bg-[#111]" style={{ minHeight: 20, cursor: 'grab', touchAction: 'none' }}>
        <span style={{ fontFamily: MONO, fontSize: 8, color: '#777', letterSpacing: '0.2em' }}>STEERING ANGLE</span>
        <LegendWarnings channel="steering" />
      </div>
      <div className="flex flex-1 min-h-0 items-center justify-center gap-6 px-4 py-2">
        <svg viewBox="0 0 120 120" role="img" aria-label={available ? `Steering wheel at ${readout}` : 'Steering angle unavailable'} className="h-full" style={{ maxHeight: 150, maxWidth: '45%', minHeight: 0 }}>
          <path d="M60 2 V9" stroke="#666" strokeWidth="2" />
          <g style={{ transform: `rotate(${available ? angle : 0}deg)`, transformOrigin: '60px 60px', transition: 'transform 100ms linear', opacity: available ? 1 : 0.35 }}>
            <circle cx="60" cy="60" r="45" fill="#101010" stroke="#555" strokeWidth="10" />
            <circle cx="60" cy="60" r="45" fill="none" stroke="#888" strokeWidth="1" />
            <path d="M60 15 V23" stroke={color} strokeWidth="6" />
            <path d="M18 53 L47 58 M102 53 L73 58 M60 73 V102" fill="none" stroke="#777" strokeWidth="9" strokeLinejoin="round" />
            <circle cx="60" cy="60" r="15" fill="#222" stroke="#999" strokeWidth="2" />
            <circle cx="60" cy="60" r="4" fill={color} />
          </g>
        </svg>
        <div style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
          <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.2 }}>{readout}</div>
          <div className="mt-2" style={{ fontSize: 8, color: '#777', letterSpacing: '0.12em' }}>{available ? 'STEERING ANGLE' : 'NO STEERING DATA'}</div>
        </div>
      </div>
    </div>
  )
}
