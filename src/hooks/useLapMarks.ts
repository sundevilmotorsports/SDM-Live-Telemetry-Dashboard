import { useCallback, useEffect, useState } from 'react'

const PREFIX = 'sdm-lap-marks:'

function load(key: string): number[] {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : []
  } catch {
    return []
  }
}

/**
 * Manual start/finish marks (session times, Frame.t clock) for one stream.
 * Stored per stream key (source + session) in this browser, so a reload keeps
 * them and a new session starts clean. Not shared between viewers.
 */
export function useLapMarks(streamKey: string) {
  const [state, setState] = useState(() => ({ key: streamKey, marks: load(streamKey) }))
  // Switching streams loads that stream's marks (during render, so there is no stale frame).
  const current = state.key === streamKey ? state : { key: streamKey, marks: load(streamKey) }
  if (current !== state) setState(current)

  useEffect(() => {
    try {
      if (current.marks.length) localStorage.setItem(PREFIX + current.key, JSON.stringify(current.marks))
      else localStorage.removeItem(PREFIX + current.key)
    } catch { /* storage full or unavailable: marks still work for this tab */ }
  }, [current])

  const addMark = useCallback((t: number) => {
    if (!Number.isFinite(t)) return
    setState(s => (s.key === streamKey ? { ...s, marks: [...s.marks, t].sort((a, b) => a - b) } : s))
  }, [streamKey])
  const undoLast = useCallback(() => {
    setState(s => (s.key === streamKey ? { ...s, marks: s.marks.slice(0, -1) } : s))
  }, [streamKey])
  const clear = useCallback(() => {
    setState(s => (s.key === streamKey ? { ...s, marks: [] } : s))
  }, [streamKey])

  return { marks: current.marks, addMark, undoLast, clear }
}
