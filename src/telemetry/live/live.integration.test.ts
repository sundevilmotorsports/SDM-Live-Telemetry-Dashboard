/**
 * Opt-in check against the hosted test project.
 * Run: LIVE_CHECK=1 npx vitest run src/telemetry/live/live.integration.test.ts
 * It subscribes with the production client, then runs the firmware one-shot poster.
 * Skipped unless LIVE_CHECK=1. Never prints the API key or HMAC key.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LiveTelemetrySession } from './LiveTelemetrySession'
import { createSupabaseBroadcastClient, resetSupabaseClient } from './supabaseBroadcast'
import { channelsToFrame, gpsPosition, sessionStartUs } from './mapToFrame'

const FIRMWARE = '/Users/ishanbansal/Documents/ASU/Formula_SAE/SDM27-Cellular-Telemetry'

function loadEnv(path: string): Record<string, string> {
  const vals: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    let value = rest.join('=').trim()
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1)
    }
    vals[key.trim()] = value
  }
  return vals
}

describe.skipIf(process.env.LIVE_CHECK !== '1')('hosted broadcast', () => {
  it('receives all three groups, maps fields, then goes stale', async () => {
    const env = loadEnv(`${FIRMWARE}/.env`)
    const key = env.HTTPS_API_KEY ?? ''
    const session = env.HTP_SESSION_ID ?? ''
    const origin = (env.HTTPS_INGEST_URL ?? '').split('/functions/')[0]
    expect(key.startsWith('sb_secret_')).toBe(false)
    expect(origin.startsWith('https://')).toBe(true)

    const client = createSupabaseBroadcastClient(origin, key)
    const live = new LiveTelemetrySession({ client, sessionId: session, staleAfterMs: 3_500 })
    live.start()

    const subscribed = await waitFor(() => live.snapshot().status === 'subscribed', 15_000)
    expect(subscribed, live.snapshot().diagnostics.lastError ?? live.snapshot().status).toBe(true)

    const poster = spawn('python3', ['scripts/post_synth_htp.py'], { cwd: FIRMWARE, env: process.env })
    let posterOut = ''
    poster.stdout.on('data', chunk => { posterOut += String(chunk) })
    poster.stderr.on('data', chunk => { posterOut += String(chunk) })
    const posterCode = await new Promise<number>(resolve => poster.on('close', code => resolve(code ?? 1)))
    const safeOut = posterOut.replace(key, '[redacted]')
    expect(posterCode, safeOut.slice(0, 500)).toBe(0)

    const merged = await waitFor(() => live.snapshot().diagnostics.groupsSeen.length === 3, 20_000)
    const snap = live.snapshot()
    expect(merged, `groups=${snap.diagnostics.groupsSeen.join(',')} received=${snap.diagnostics.received} error=${snap.diagnostics.lastError ?? ''}`).toBe(true)
    expect(snap.diagnostics.groupsSeen).toEqual([0, 1, 2])
    expect(snap.freshness).toBe('fresh')

    const mapped = channelsToFrame(snap.channels, sessionStartUs(snap.channels))
    expect(mapped.frame.speed).toBeGreaterThan(0)
    expect(mapped.frame.rpm).toBeGreaterThan(0)
    expect(mapped.frame.throttle).toBeGreaterThanOrEqual(0)
    expect(mapped.frame.oilPress).toBeGreaterThan(0)
    expect(mapped.frame.volt).toBeGreaterThan(10)
    expect(mapped.frame.fuel).toBeNaN()
    expect(mapped.frame.wFL).toBeNaN()
    expect(gpsPosition(snap.channels)).not.toBeNull()
    expect(snap.channels['brake.rear_pressure']).toBeDefined()

    await delay(4_000)
    expect(live.snapshot(Date.now()).freshness).toBe('stale')
    live.stop()
    resetSupabaseClient()
  }, 45_000)
})

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true
    await delay(100)
  }
  return pred()
}
