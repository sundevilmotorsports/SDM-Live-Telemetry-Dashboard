import { useId } from 'react'
import { fmtDuration, type ChartInspection } from '../telemetry/chartView'
import { MONO, clamp } from '../telemetry/simulation'

export default function FuelTank({ inspection }: { inspection: ChartInspection | null }) {
  const clipId = useId()
  const fuel = inspection?.frame?.fuel ?? NaN
  const available = Number.isFinite(fuel)
  const level = available ? clamp(fuel, 0, 100) : 0
  const color = !available ? '#555' : fuel < 15 ? '#ff4d4d' : fuel < 30 ? '#ffb340' : '#33ff99'

  return <div className="flex flex-col h-full min-w-0 bg-[#171717] border-t border-l border-[#222]">
    <div className="panel-drag flex items-center justify-between gap-2 px-3 border-b border-[#222] bg-[#111]" style={{ minHeight: 20, cursor: 'grab', touchAction: 'none' }}>
      <span style={{ fontFamily: MONO, fontSize: 8, color: '#777', letterSpacing: '0.15em' }}>FUEL TANK</span>
      <span title="Follows the trace cursor, or the right edge of the visible time range" style={{ fontFamily: MONO, fontSize: 7, color: '#999' }}>TIME LINKED</span>
    </div>
    <div className="flex flex-1 min-h-0 items-center justify-center gap-3 px-3 py-2" style={{ fontFamily: MONO }}>
      <svg viewBox="0 0 90 120" role="img" aria-label={available ? `Fuel tank ${fuel.toFixed(1)} percent full` : 'Fuel level unavailable at the selected time'} className="h-full" style={{ maxHeight: 150, maxWidth: '40%', minHeight: 0 }}>
        <defs><clipPath id={clipId}><rect x="15" y="18" width="52" height="90" rx="7" /></clipPath></defs>
        <path d="M34 18 V10 H49 V18" fill="#222" stroke="#777" strokeWidth="2" />
        <rect x="15" y="18" width="52" height="90" rx="7" fill="#101010" stroke="#777" strokeWidth="2" />
        {available && <g clipPath={`url(#${clipId})`}>
          <rect x="16" y={108 - level * 0.9} width="50" height={level * 0.9} fill={color} opacity="0.35" />
          <path d={`M16 ${108 - level * 0.9} H66`} stroke={color} strokeWidth="2" />
        </g>}
        {[0, 25, 50, 75, 100].map(tick => <path key={tick} d={`M70 ${108 - tick * 0.9} h${tick === 0 || tick === 100 ? 7 : 4}`} stroke="#666" />)}
        <text x="41" y="70" textAnchor="middle" fill={available ? color : '#666'} fontSize="16" fontFamily={MONO}>{available ? 'F' : '?'}</text>
      </svg>
      <div className="min-w-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <div style={{ fontSize: 23, fontWeight: 700, color }}>{available ? `${fuel.toFixed(1)}%` : '—'}</div>
        <div className="mt-1" style={{ fontSize: 7, color: '#999', letterSpacing: '0.06em' }}>{available ? 'FUEL REMAINING' : 'FUEL UNAVAILABLE'}</div>
        <div className="mt-2" style={{ fontSize: 8, color: '#bbb' }}>{inspection?.frame ? `SESSION ${fmtDuration(inspection.frame.t)}` : 'NO SELECTED SAMPLE'}</div>
        <div className="mt-1" style={{ fontSize: 7, color: '#777' }}>{inspection ? `${inspection.mode === 'cursor' ? 'CURSOR' : 'VIEW END'} · ${inspection.label}` : 'WAITING FOR TRACES'}</div>
      </div>
    </div>
  </div>
}
