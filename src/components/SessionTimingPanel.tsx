import { Frame, MONO, LAP_LEN, fmtTime, fmtDelta, SECTOR_BOUNDS } from '../telemetry/simulation'
import { Lap } from '../telemetry/useTelemetry'

function secStr(s: number) { return s.toFixed(3) }

export function SessionTimingPanel({ cur, laps, bestLap, bestSectors, theoretical, totalLaps }: {
  cur: Frame | undefined
  laps: Lap[]
  bestLap: Lap | null
  bestSectors: [number, number, number]
  theoretical: number
  totalLaps: number
}) {
  const recent = laps.slice(-9)
  // live sector progress for current lap
  const lapKnown = !!cur && Number.isFinite(cur.lapTime)
  const lapFrac = lapKnown ? cur.lapTime / LAP_LEN : 0
  const curSector = lapFrac < SECTOR_BOUNDS[0] ? 0 : lapFrac < SECTOR_BOUNDS[1] ? 1 : 2

  return (
    <div className="flex flex-col border-l border-[#1e1e1e] bg-[#111111]" style={{ width: 218, flexShrink: 0 }}>
      <div className="flex items-center justify-between px-3 border-b border-[#1e1e1e]" style={{ height: 20 }}>
        <span style={{ fontFamily: MONO, fontSize: 8, color: '#2a2a2a', letterSpacing: '0.2em' }}>SESSION TIMING</span>
      </div>
      <div className="flex items-center px-2 border-b border-[#1a1a1a]" style={{ height: 17 }}>
        {(['LAP', 'S1', 'S2', 'S3', 'DELTA'] as string[]).map((h, i) => (
          <span key={h} style={{ fontFamily: MONO, fontSize: 7, color: '#333', flex: i === 0 ? '0 0 22px' : 1, textAlign: i > 0 ? 'right' : 'left', letterSpacing: '0.1em' }}>{h}</span>
        ))}
      </div>
      <div className="flex flex-col overflow-y-auto flex-1">
        {recent.length === 0 && (
          <div className="flex items-center justify-center flex-1 px-3" style={{ minHeight: 60 }}>
            <span style={{ fontFamily: MONO, fontSize: 8, color: '#333', textAlign: 'center' }}>AWAITING FIRST<br />COMPLETED LAP…</span>
          </div>
        )}
        {recent.map(lap => {
          const isBest = bestLap?.num === lap.num
          const delta = bestLap ? lap.total - bestLap.total : 0
          return (
            <div key={lap.num} className="flex items-center px-2 border-b border-[#161616]" style={{ height: 22, backgroundColor: isBest ? '#00ff4108' : 'transparent' }}>
              <span style={{ fontFamily: MONO, fontSize: 8, color: '#555', flex: '0 0 22px' }}>{lap.num}</span>
              {[lap.s1, lap.s2, lap.s3].map((s, i) => (
                <span key={i} style={{ fontFamily: MONO, fontSize: 8, color: bestSectors[i] === s ? '#c88bff' : '#444', flex: 1, textAlign: 'right' }}>{secStr(s)}</span>
              ))}
              <span style={{ fontFamily: MONO, fontSize: 8, flex: 1, textAlign: 'right', color: isBest ? '#00ff41' : delta <= 0 ? '#00ff41' : '#ff6644', fontWeight: isBest ? 700 : 400 }}>
                {isBest ? 'BEST' : fmtDelta(delta)}
              </span>
            </div>
          )
        })}
        {lapKnown && cur && (
          <div className="flex items-center px-2 border-b border-[#1e1e1e]" style={{ height: 22, backgroundColor: '#4488ff0a' }}>
            <span style={{ fontFamily: MONO, fontSize: 8, color: '#4488ff', flex: '0 0 22px', fontWeight: 700 }}>{Number.isFinite(cur.lapNum) ? cur.lapNum : '—'}</span>
            {[0, 1, 2].map(i => (
              <span key={i} style={{ fontFamily: MONO, fontSize: 8, color: i === curSector ? '#4488ff' : '#4488ff66', flex: 1, textAlign: 'right', fontWeight: i === curSector ? 700 : 400 }}>
                {i < curSector ? secStr(SECTOR_BOUNDS[0] * LAP_LEN) : i === curSector ? fmtTime(cur.lapTime).slice(2) : '—'}
              </span>
            ))}
            <span style={{ fontFamily: MONO, fontSize: 8, color: '#4488ff', flex: 1, textAlign: 'right' }}>IN LAP</span>
          </div>
        )}
      </div>
      <div className="flex flex-col border-t border-[#1e1e1e] px-2 py-2 gap-1">
        {([
          ['BEST LAP', bestLap ? fmtTime(bestLap.total) : '—', '#00ff41'],
          ['THEORETICAL', isFinite(theoretical) ? fmtTime(theoretical) : '—', '#c88bff'],
          ['LAPS DONE', `${laps.length} / ${totalLaps}`, '#888'],
        ] as [string, string, string][]).map(([label, val, color]) => (
          <div key={label} className="flex items-center justify-between">
            <span style={{ fontFamily: MONO, fontSize: 7, color: '#2a2a2a', letterSpacing: '0.15em' }}>{label}</span>
            <span style={{ fontFamily: MONO, fontSize: 9, color, fontWeight: 700 }}>{val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
