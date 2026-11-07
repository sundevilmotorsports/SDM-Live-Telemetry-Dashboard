import { useCallback, useEffect, useState } from 'react'
import { MONO } from '../telemetry/simulation'
import { useConfig } from '../state/ConfigContext'
import { useSupabaseAuth } from '../telemetry/sessions/useSupabaseAuth'
import {
  endSession, listSessions, signInWithPassword, signOut, startSession, type TelemetrySession,
} from '../telemetry/sessions/sessionsApi'

const inputStyle: React.CSSProperties = { backgroundColor: '#1a1a1a', color: '#999', border: '1px solid #2e2e2e', fontFamily: MONO, fontSize: 9, padding: '4px 6px', borderRadius: 3, width: '100%', outline: 'none' }
const labelStyle: React.CSSProperties = { fontFamily: MONO, fontSize: 8, color: '#3a3a3a', letterSpacing: '0.12em' }
const noteStyle: React.CSSProperties = { fontFamily: MONO, fontSize: 8, color: '#888', lineHeight: 1.5 }

function btn(color: string, enabled = true): React.CSSProperties {
  return {
    fontFamily: MONO, fontSize: 8, color: enabled ? color : '#555', backgroundColor: `${enabled ? color : '#555'}12`,
    border: `1px solid ${enabled ? color : '#555'}30`, padding: '5px 8px', borderRadius: 3, letterSpacing: '0.1em',
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.6, flex: 1,
  }
}

export function sessionLabel(s: TelemetrySession): string {
  const when = new Date(s.startedAt ?? s.createdAt)
  const stamp = Number.isNaN(when.getTime()) ? '' : ` · ${when.toLocaleString()}`
  return `${s.status === 'running' ? '● ' : ''}${s.name} · ${s.status}${stamp}`
}

/** Supabase Auth sign-in, device field, start/end session, and the past-session picker (raw mode). */
export default function SessionControls() {
  const cfg = useConfig()
  const auth = useSupabaseAuth(cfg.supabaseUrl, cfg.supabaseAnonKey)
  const client = auth.client
  const signedIn = auth.status === 'signed-in'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<TelemetrySession[]>([])
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!client || !signedIn) { setSessions([]); return }
    const controller = new AbortController()
    // Debounced so typing a device ID does not issue a query per keystroke.
    const timer = window.setTimeout(() => {
      listSessions(client, { deviceId: cfg.telemetryDeviceId, signal: controller.signal })
        .then(rows => { if (!controller.signal.aborted) setSessions(rows) })
        .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
    }, 400)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [client, signedIn, cfg.telemetryDeviceId, refreshTick])

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }, [])

  const linked = sessions.find(s => s.id === cfg.telemetrySessionId) ?? null
  const hasDevice = cfg.telemetryDeviceId.trim().length > 0
  const canEnd = signedIn && !busy && cfg.telemetrySessionId.trim().length > 0 && (linked === null || linked.status === 'running')

  return (
    <div className="flex flex-col gap-2 p-2 rounded" style={{ backgroundColor: '#0c0c0c', border: '1px solid #222' }}>
      <span style={labelStyle}>ACCOUNT</span>
      {auth.status === 'misconfigured' && <span style={noteStyle}>Enter the project URL and a publishable key to sign in.</span>}
      {auth.status === 'loading' && <span style={noteStyle}>Checking sign-in…</span>}
      {(auth.status === 'signed-out') && (
        <form className="flex flex-col gap-1.5" onSubmit={e => {
          e.preventDefault()
          void run(async () => { await signInWithPassword(client!, email, password); setPassword('') })
        }}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email" autoComplete="username" style={inputStyle} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" autoComplete="current-password" style={inputStyle} />
          <button type="submit" disabled={busy} style={btn('#4488ff', !busy)}>SIGN IN</button>
          <span style={noteStyle}>Raw CAN data is readable by signed-in users only.</span>
        </form>
      )}
      {signedIn && (
        <div className="flex items-center gap-2">
          <span style={{ ...noteStyle, flex: 1, color: '#9c9' }}>Signed in as {auth.email}</span>
          <button disabled={busy} onClick={() => void run(() => signOut(client!))} style={{ ...btn('#ff6644', !busy), flex: '0 0 auto' }}>SIGN OUT</button>
        </div>
      )}

      <span style={labelStyle}>DEVICE ID (matches the x-htp-device header the car signs)</span>
      <input value={cfg.telemetryDeviceId} onChange={e => cfg.setTelemetryDeviceId(e.target.value)} placeholder="esp32-sim7670g-poc-01" style={inputStyle} />
      <div className="flex gap-2">
        <button
          disabled={!signedIn || busy || !hasDevice}
          onClick={() => void run(async () => {
            const started = await startSession(client!, cfg.telemetryDeviceId)
            cfg.setTelemetrySessionId(started.id)
            setRefreshTick(n => n + 1)
          })}
          style={btn('#00ff41', signedIn && !busy && hasDevice)}
        >START SESSION</button>
        <button
          disabled={!canEnd}
          onClick={() => void run(async () => {
            await endSession(client!, cfg.telemetrySessionId)
            setRefreshTick(n => n + 1)
          })}
          style={btn('#ff3333', canEnd)}
        >END SESSION</button>
      </div>
      <span style={noteStyle}>
        Start ends any session already running for this device, then links this dashboard to the new one. The car's batches go to the device's running session.
      </span>

      <span style={labelStyle}>SESSION</span>
      <select
        value={sessions.some(s => s.id === cfg.telemetrySessionId) ? cfg.telemetrySessionId : ''}
        onChange={e => cfg.setTelemetrySessionId(e.target.value)}
        disabled={!signedIn}
        style={inputStyle}
      >
        <option value="">{signedIn ? (sessions.length ? 'Pick a session…' : 'No sessions for this device') : 'Sign in to list sessions'}</option>
        {sessions.map(s => <option key={s.id} value={s.id}>{sessionLabel(s)}</option>)}
      </select>
      <div className="flex items-center gap-2">
        <span style={{ ...noteStyle, flex: 1, wordBreak: 'break-all' }}>
          Linked: {cfg.telemetrySessionId || 'none'}{linked ? ` (${linked.status})` : ''}
        </span>
        <button disabled={!signedIn} onClick={() => setRefreshTick(n => n + 1)} style={{ ...btn('#c88bff', signedIn), flex: '0 0 auto' }}>REFRESH</button>
      </div>
      {error && <span style={{ ...noteStyle, color: '#ff6644' }}>{error}</span>}
    </div>
  )
}
