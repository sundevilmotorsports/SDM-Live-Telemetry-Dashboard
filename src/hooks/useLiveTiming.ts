import { useEffect, useRef, useState } from 'react'
import { seeded } from '../telemetry/simulation'

// ── Simulated FSAE endurance live-timing (competitor cars) ───────────────────
export interface Competitor {
  car: number
  team: string
  lastLap: number
  bestLap: number
  laps: number
  gap: number          // gap to leader in seconds
  isOurs: boolean
}

const TEAMS = [
  [7, 'GreenLeaf Racing'], [14, 'Apex Motorsport'], [3, 'Volt Dynamics'],
  [22, 'Redshift FSAE'], [9, 'Titan Racing'], [41, 'Nova Speedworks'],
  [17, 'Carbon Collective'], [88, 'Ignition Labs'],
] as const

export function useLiveTiming(): Competitor[] {
  const base = useRef(
    TEAMS.map(([car, team], i) => ({
      car, team,
      pace: 85 + i * 0.35 + seeded(car, 1) * 0.6, // seconds per lap baseline
      best: 999,
      last: 0,
      laps: 0,
      accum: 0,
      isOurs: car === 22,
    })),
  )
  const [rows, setRows] = useState<Competitor[]>([])

  useEffect(() => {
    const tick = () => {
      const cars = base.current
      for (const c of cars) {
        c.last = c.pace + Math.abs(seeded(c.car * 7 + c.laps, 3)) * 2.4
        c.best = Math.min(c.best, c.last)
        c.laps++
        c.accum += c.last
      }
      const minAccum = Math.min(...cars.map(c => c.accum))
      const sorted = [...cars].sort((a, b) => a.accum - b.accum)
      setRows(sorted.map(c => ({
        car: c.car, team: c.team, lastLap: c.last, bestLap: c.best,
        laps: c.laps, gap: c.accum - minAccum, isOurs: c.isOurs,
      })))
    }
    tick()
    const id = setInterval(tick, 4200)
    return () => clearInterval(id)
  }, [])

  return rows
}
