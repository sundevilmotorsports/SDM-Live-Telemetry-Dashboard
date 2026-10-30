import { Frame, MONO, fmtTime, fmtNum, LAP_LEN } from '../telemetry/simulation'
import { Lap } from '../telemetry/useTelemetry'
import { EMPTY_FRAME } from '../components/panels'

// Shift-light bar: 15 LEDs green→yellow→red, lit by RPM fraction
function ShiftLights({ rpm }: { rpm: number }) {
  const N = 15
  const frac = Math.min(1, rpm / 8000)
  const lit = Math.floor(frac * N)
  const shift = rpm > 7400
  return (
    <div className="flex items-center justify-center gap-1.5" style={{ opacity: shift && Math.floor(Date.now() / 120) % 2 ? 0.2 : 1 }}>
      {Array.from({ length: N }, (_, i) => {
        const on = i < lit
        const col = i < 6 ? '#00ff41' : i < 11 ? '#ffdd00' : '#ff2222'
        return <div key={i} style={{ width: 26, height: 14, borderRadius: 3, backgroundColor: on ? col : '#161616', boxShadow: on ? `0 0 14px ${col}` : 'none', border: `1px solid ${on ? col : '#222'}` }} />
      })}
    </div>
  )
}

function WarnLight({ label, active, color }: { label: string; active: boolean; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5" style={{ flex: 1 }}>
      <div style={{ width: 42, height: 42, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: active ? `${color}22` : '#141414', border: `1.5px solid ${active ? color : '#242424'}`, boxShadow: active ? `0 0 18px ${color}66` : 'none' }}>
        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: active ? color : '#333' }}>{label}</span>
      </div>
    </div>
  )
}

function Setting({ label, value, color = '#e0e0e0' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center justify-center" style={{ flex: 1, borderRight: '1px solid #1c1c1c' }}>
      <span style={{ fontFamily: MONO, fontSize: 9, color: '#404040', letterSpacing: '0.2em' }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</span>
    </div>
  )
}

export function DriverDash({ frames, bestLap }: { frames: Frame[]; bestLap: Lap | null }) {
  const cur = frames[frames.length - 1] ?? EMPTY_FRAME
  // fake steering-wheel settings driven off state so they feel live
  const throttleKnown = Number.isFinite(cur.throttle)
  const steeringKnown = Number.isFinite(cur.steering)
  const brakeKnown = Number.isFinite(cur.brake)
  const mapMode = throttleKnown ? 3 + (cur.throttle > 90 ? 1 : 0) : NaN
  const tc = steeringKnown ? 4 - Math.round((Math.abs(cur.steering) / 90) * 2) : NaN
  const bb = brakeKnown ? (54 + (cur.brake / 200) * 4).toFixed(1) : null
  const delta = bestLap && Number.isFinite(cur.lapTime) ? cur.lapTime - (bestLap.total * (cur.lapTime / LAP_LEN)) : NaN

  const gearColor = cur.rpm > 7400 ? '#ff2222' : cur.rpm > 6800 ? '#ffdd00' : '#00ffff'

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d] overflow-hidden">
      {/* shift lights */}
      <div className="flex items-center justify-center py-4 border-b border-[#1a1a1a]" style={{ flexShrink: 0 }}>
        <ShiftLights rpm={cur.rpm} />
      </div>

      {/* main cluster */}
      <div className="flex flex-1 items-stretch" style={{ minHeight: 0 }}>
        {/* left column: lap + delta */}
        <div className="flex flex-col items-center justify-center gap-6" style={{ width: '26%', borderRight: '1px solid #161616' }}>
          <div className="flex flex-col items-center">
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#404040', letterSpacing: '0.3em' }}>LAP</span>
            <span style={{ fontFamily: MONO, fontSize: 64, fontWeight: 700, color: '#e0e0e0', lineHeight: 1 }}>{Number.isFinite(cur.lapNum) ? cur.lapNum : '—'}</span>
          </div>
          <div className="flex flex-col items-center">
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#404040', letterSpacing: '0.3em' }}>LAP TIME</span>
            <span style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, color: '#00ffff' }}>{fmtTime(cur.lapTime)}</span>
          </div>
          <div className="flex flex-col items-center">
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#404040', letterSpacing: '0.3em' }}>DELTA</span>
            <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: !Number.isFinite(delta) ? '#555' : delta <= 0 ? '#00ff41' : '#ff4444' }}>{Number.isFinite(delta) ? `${delta <= 0 ? '' : '+'}${delta.toFixed(2)}` : '—'}</span>
          </div>
        </div>

        {/* center: giant gear */}
        <div className="flex flex-col items-center justify-center" style={{ flex: 1 }}>
          <span style={{ fontFamily: MONO, fontSize: 220, fontWeight: 700, color: gearColor, lineHeight: 0.9, textShadow: `0 0 60px ${gearColor}55` }}>{Number.isFinite(cur.gear) ? Math.round(cur.gear) : '—'}</span>
          <span style={{ fontFamily: MONO, fontSize: 22, color: '#404040', letterSpacing: '0.4em', marginTop: 8 }}>{fmtNum(cur.rpm, 0)} RPM</span>
        </div>

        {/* right: big speed */}
        <div className="flex flex-col items-center justify-center gap-4" style={{ width: '26%', borderLeft: '1px solid #161616' }}>
          <div className="flex flex-col items-center">
            <span style={{ fontFamily: MONO, fontSize: 96, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{fmtNum(cur.speed, 0)}</span>
            <span style={{ fontFamily: MONO, fontSize: 14, color: '#404040', letterSpacing: '0.3em' }}>KM/H</span>
          </div>
          <div className="flex flex-col items-center">
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#404040', letterSpacing: '0.3em' }}>FUEL</span>
            <span style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, color: !Number.isFinite(cur.fuel) ? '#555' : cur.fuel < 15 ? '#ff4444' : '#33ff99' }}>{Number.isFinite(cur.fuel) ? `${cur.fuel.toFixed(0)}%` : '—'}</span>
          </div>
        </div>
      </div>

      {/* warning lights row */}
      <div className="flex items-center justify-around px-8 py-4 border-t border-[#1a1a1a]" style={{ flexShrink: 0 }}>
        <WarnLight label="OIL" active={cur.oilPress < 2 || cur.oilTemp > 130} color="#ff3333" />
        <WarnLight label="H₂O" active={cur.coolant > 105} color="#ff6644" />
        <WarnLight label="BAT" active={cur.volt < 11.5} color="#ffdd00" />
        <WarnLight label="FUEL" active={cur.fuel < 15} color="#ff8800" />
        <WarnLight label="ABS" active={cur.brake > 150} color="#00ffff" />
        <WarnLight label="TC" active={Math.abs(cur.gX) > 1.8} color="#00ff41" />
        <WarnLight label="DRS" active={cur.throttle > 95 && cur.speed > 180} color="#4488ff" />
      </div>

      {/* steering wheel settings strip */}
      <div className="flex items-stretch border-t border-[#1a1a1a] bg-[#111]" style={{ height: 78, flexShrink: 0 }}>
        <Setting label="ENGINE MAP" value={fmtNum(mapMode, 0)} color="#00ff41" />
        <Setting label="TC LEVEL" value={Number.isFinite(tc) ? String(Math.max(1, tc)) : '—'} color="#ffdd00" />
        <Setting label="BRAKE BIAS" value={bb == null ? '—' : `${bb}%`} color="#ff6644" />
        <Setting label="DIFF" value={throttleKnown ? String(6 - Math.round((cur.throttle / 100) * 3)) : '—'} color="#00ffff" />
        <div className="flex flex-col items-center justify-center" style={{ flex: 1 }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: '#404040', letterSpacing: '0.2em' }}>OIL TEMP</span>
          <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: !Number.isFinite(cur.oilTemp) ? '#555' : cur.oilTemp > 130 ? '#ff4444' : '#e0e0e0' }}>{Number.isFinite(cur.oilTemp) ? `${cur.oilTemp.toFixed(0)}°` : '—'}</span>
        </div>
      </div>
    </div>
  )
}
