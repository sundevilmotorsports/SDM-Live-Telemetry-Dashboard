import { MONO, fmtTime, fmtDelta, CHANNEL_MAP } from '../telemetry/simulation'
import { Lap } from '../telemetry/useTelemetry'
import { useConfig } from '../state/ConfigContext'
import { useLiveTiming } from '../hooks/useLiveTiming'

const KPI = ['speed', 'rpm', 'throttle', 'brake']

function Panel({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="flex flex-col bg-[#171717] border border-[#222] rounded overflow-hidden" style={style}>
      <div className="flex items-center px-3 border-b border-[#222] bg-[#111]" style={{ height: 22, flexShrink: 0 }}>
        <span style={{ fontFamily: MONO, fontSize: 8, color: '#3a3a3a', letterSpacing: '0.25em' }}>{title}</span>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}

function LapTrend({ laps, bestLap }: { laps: Lap[]; bestLap: Lap | null }) {
  if (laps.length < 2) return <div className="flex items-center justify-center h-full"><span style={{ fontFamily: MONO, fontSize: 9, color: '#333' }}>NEED 2+ LAPS</span></div>
  const totals = laps.map(l => l.total)
  const min = Math.min(...totals), max = Math.max(...totals), span = max - min || 1
  const W = 600, H = 120, pad = 10
  const x = (i: number) => pad + (i / (laps.length - 1)) * (W - 2 * pad)
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad)
  const path = laps.map((l, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(l.total).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <defs><filter id="lt-glow"><feGaussianBlur stdDeviation="1.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <path d={path} fill="none" stroke="#00ffff" strokeWidth="1.5" filter="url(#lt-glow)" />
      {laps.map((l, i) => {
        const isBest = bestLap?.num === l.num
        return <circle key={l.num} cx={x(i)} cy={y(l.total)} r={isBest ? 3 : 1.8} fill={isBest ? '#00ff41' : '#00ffff'} />
      })}
    </svg>
  )
}

export function LapAnalysis({ laps, bestLap, bestSectors, theoretical, totalLaps }: {
  laps: Lap[]; bestLap: Lap | null; bestSectors: [number, number, number]; theoretical: number; totalLaps: number
}) {
  const { math } = useConfig()
  const competitors = useLiveTiming()

  const reversed = [...laps].reverse()

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d] overflow-hidden p-2 gap-2">
      {/* summary strip */}
      <div className="flex gap-2" style={{ flexShrink: 0 }}>
        {([
          ['BEST LAP', bestLap ? fmtTime(bestLap.total) : '—', '#00ff41'],
          ['THEORETICAL', isFinite(theoretical) ? fmtTime(theoretical) : '—', '#c88bff'],
          ['BEST S1', isFinite(bestSectors[0]) ? bestSectors[0].toFixed(3) : '—', '#00ffff'],
          ['BEST S2', isFinite(bestSectors[1]) ? bestSectors[1].toFixed(3) : '—', '#ffff00'],
          ['BEST S3', isFinite(bestSectors[2]) ? bestSectors[2].toFixed(3) : '—', '#ff8800'],
          ['LAPS DONE', `${laps.length} / ${totalLaps}`, '#888'],
        ] as [string, string, string][]).map(([label, val, color]) => (
          <div key={label} className="flex flex-col justify-center px-4 py-2 bg-[#141414] border border-[#222] rounded" style={{ flex: 1 }}>
            <span style={{ fontFamily: MONO, fontSize: 8, color: '#3a3a3a', letterSpacing: '0.2em' }}>{label}</span>
            <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color }}>{val}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2" style={{ flex: 1, minHeight: 0 }}>
        {/* lap report table */}
        <Panel title="LAP REPORT — SECTOR & KPI BREAKDOWN" style={{ flex: 2 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO }}>
            <thead>
              <tr style={{ backgroundColor: '#131313' }}>
                {['LAP', 'S1', 'S2', 'S3', 'TOTAL', 'Δ BEST', ...KPI.map(k => `AVG ${CHANNEL_MAP[k].label.toUpperCase().slice(0, 6)}`)].map((h, i) => (
                  <th key={h} style={{ fontSize: 7.5, color: '#3a3a3a', letterSpacing: '0.1em', padding: '5px 8px', textAlign: i === 0 ? 'left' : 'right', borderBottom: '1px solid #222', position: 'sticky', top: 0, backgroundColor: '#131313' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reversed.length === 0 && <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 9, color: '#333' }}>NO COMPLETED LAPS YET…</td></tr>}
              {reversed.map(l => {
                const isBest = bestLap?.num === l.num
                const delta = bestLap ? l.total - bestLap.total : 0
                return (
                  <tr key={l.num} style={{ backgroundColor: isBest ? '#00ff4108' : 'transparent' }}>
                    <td style={{ fontSize: 9, color: '#888', padding: '5px 8px', fontWeight: 700 }}>{l.num}</td>
                    {[l.s1, l.s2, l.s3].map((s, i) => (
                      <td key={i} style={{ fontSize: 9, color: bestSectors[i] === s ? '#c88bff' : '#666', padding: '5px 8px', textAlign: 'right', fontWeight: bestSectors[i] === s ? 700 : 400 }}>{s.toFixed(3)}</td>
                    ))}
                    <td style={{ fontSize: 9, color: isBest ? '#00ff41' : '#bbb', padding: '5px 8px', textAlign: 'right', fontWeight: 700 }}>{fmtTime(l.total)}</td>
                    <td style={{ fontSize: 9, color: isBest ? '#00ff41' : delta <= 0 ? '#00ff41' : '#ff6644', padding: '5px 8px', textAlign: 'right' }}>{isBest ? 'BEST' : fmtDelta(delta)}</td>
                    {KPI.map(k => <td key={k} style={{ fontSize: 9, color: '#555', padding: '5px 8px', textAlign: 'right' }}>{l.avg[k]?.toFixed(k === 'rpm' ? 0 : 1)}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {math.length > 0 && reversed.length > 0 && (
            <div className="px-3 py-2 border-t border-[#222]">
              <span style={{ fontFamily: MONO, fontSize: 7.5, color: '#3a3a3a', letterSpacing: '0.2em' }}>MATH CHANNELS — last lap avg not tracked per-lap; live values shown on gauges.</span>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
          {/* lap trend */}
          <Panel title="LAP TIME TREND" style={{ flex: 1 }}>
            <div className="p-2 h-full"><LapTrend laps={laps} bestLap={bestLap} /></div>
          </Panel>
          {/* FSAE live timing leaderboard */}
          <Panel title="FSAE ENDURANCE — LIVE TIMING" style={{ flex: 1.4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO }}>
              <thead>
                <tr style={{ backgroundColor: '#131313' }}>
                  {['P', 'CAR', 'TEAM', 'LAST', 'BEST', 'GAP'].map((h, i) => (
                    <th key={h} style={{ fontSize: 7.5, color: '#3a3a3a', padding: '5px 6px', textAlign: i < 3 ? 'left' : 'right', borderBottom: '1px solid #222' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {competitors.map((c, i) => (
                  <tr key={c.car} style={{ backgroundColor: c.isOurs ? '#4488ff14' : 'transparent' }}>
                    <td style={{ fontSize: 9, color: i === 0 ? '#ffdd00' : '#666', padding: '4px 6px', fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ fontSize: 9, color: c.isOurs ? '#4488ff' : '#999', padding: '4px 6px', fontWeight: 700 }}>#{c.car}</td>
                    <td style={{ fontSize: 8, color: c.isOurs ? '#4488ff' : '#555', padding: '4px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>{c.team}</td>
                    <td style={{ fontSize: 8.5, color: '#888', padding: '4px 6px', textAlign: 'right' }}>{fmtTime(c.lastLap)}</td>
                    <td style={{ fontSize: 8.5, color: '#00ff41', padding: '4px 6px', textAlign: 'right' }}>{fmtTime(c.bestLap)}</td>
                    <td style={{ fontSize: 8.5, color: i === 0 ? '#ffdd00' : '#ff6644', padding: '4px 6px', textAlign: 'right' }}>{i === 0 ? 'LEADER' : `+${c.gap.toFixed(1)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </div>
  )
}
