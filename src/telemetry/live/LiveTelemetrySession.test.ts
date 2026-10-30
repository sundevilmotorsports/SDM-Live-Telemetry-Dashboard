import { describe, expect, it } from 'vitest'
import { LiveTelemetrySession } from './LiveTelemetrySession'
import type { BroadcastClient, BroadcastStatusHandler, BroadcastSubscription } from './broadcastClient'

const SESSION = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

interface FakeSub {
  topic: string
  onMessage: (payload: unknown) => void
  onStatus: BroadcastStatusHandler
  unsubscribe: () => void
  active: boolean
}

class FakeClient implements BroadcastClient {
  subs: FakeSub[] = []
  activeCount = 0

  subscribe(options: {
    topic: string
    event: string
    isPrivate: boolean
    onMessage: (payload: unknown) => void
    onStatus: BroadcastStatusHandler
  }): BroadcastSubscription {
    const sub: FakeSub = {
      topic: options.topic,
      onMessage: options.onMessage,
      onStatus: options.onStatus,
      active: true,
      unsubscribe: () => {
        sub.active = false
        this.activeCount--
      },
    }
    this.subs.push(sub)
    this.activeCount++
    expect(options.event).toBe('live')
    expect(options.isPrivate).toBe(false)
    expect(options.topic.startsWith('realtime:')).toBe(false)
    return { unsubscribe: () => sub.unsubscribe() }
  }

  emit(payload: unknown, index = this.subs.length - 1) {
    const sub = this.subs[index]
    if (sub.active) sub.onMessage(payload)
  }

  status(status: Parameters<BroadcastStatusHandler>[0], error?: string, index = this.subs.length - 1) {
    const sub = this.subs[index]
    if (sub.active) sub.onStatus(status, error)
  }
}

function live(values: Record<string, number>, tUs: number, seq = 0) {
  return {
    type: 'broadcast',
    event: 'live',
    payload: { seq, send_timestamp_ms: 1_790_000_001_000, t_us: tUs, values },
  }
}

describe('LiveTelemetrySession', () => {
  it('subscribes once, merges three groups with equal seq, and reports them', () => {
    const client = new FakeClient()
    let now = 10_000
    const accepted: string[][] = []
    const session = new LiveTelemetrySession({
      client,
      sessionId: SESSION,
      staleAfterMs: 3_500,
      now: () => now,
      onAccepted: snapshot => accepted.push(Object.keys(snapshot.channels)),
    })
    session.start()
    expect(client.activeCount).toBe(1)
    expect(client.subs[0].topic).toBe(`telemetry:live:${SESSION}`)
    client.status('subscribed')

    client.emit(live({ 'engine.rpm': 4000, 'engine.tps': 22 }, 1_790_000_000_900_000, 0))
    now = 10_200
    client.emit(live({ 'gps.lat_ref': 33.42, 'gps.lat_d': 0.002, 'gps.speed': 18 }, 1_790_000_000_900_000, 0))
    now = 10_400
    client.emit(live({ 'engine.oil_pressure': 420, 'engine.battery_voltage': 13.4 }, 1_790_000_000_000_000, 0))

    const snap = session.snapshot(10_400)
    expect(snap.status).toBe('subscribed')
    expect(snap.freshness).toBe('fresh')
    expect(snap.diagnostics.accepted).toBe(3)
    expect(snap.diagnostics.groupsSeen).toEqual([0, 1, 2])
    expect(snap.channels['engine.rpm'].value).toBe(4000)
    expect(snap.channels['gps.speed'].value).toBe(18)
    expect(snap.channels['engine.oil_pressure'].value).toBe(420)
    expect(snap.channels['engine.battery_voltage'].value).toBe(13.4)
    expect(accepted).toHaveLength(3)
    expect(snap.diagnostics.uplinkEstimateMs).not.toBeNull()
    session.stop()
    expect(client.activeCount).toBe(0)
  })

  it('does not refresh freshness on a duplicate and counts it as old', () => {
    const client = new FakeClient()
    let now = 1_000
    const session = new LiveTelemetrySession({ client, sessionId: SESSION, staleAfterMs: 3_500, now: () => now })
    session.start()
    client.emit(live({ 'engine.rpm': 1000 }, 5000))
    now = 8_000
    client.emit(live({ 'engine.rpm': 1000 }, 5000))
    const snap = session.snapshot(8_000)
    expect(snap.diagnostics.accepted).toBe(1)
    expect(snap.diagnostics.ignoredOld).toBe(1)
    expect(snap.freshness).toBe('stale')
    expect(snap.channels['engine.rpm'].receivedAtMs).toBe(1_000)
    expect(snap.diagnostics.lastAcceptedMs).toBe(1_000)
  })

  it('rejects invalid values without crashing and without zeroing the channel', () => {
    const client = new FakeClient()
    const session = new LiveTelemetrySession({ client, sessionId: SESSION, staleAfterMs: 3_500, now: () => 50 })
    session.start()
    client.emit({
      type: 'broadcast',
      event: 'live',
      payload: {
        seq: 0,
        send_timestamp_ms: 1_000,
        t_us: 2_000,
        values: { 'engine.rpm': 3000, 'engine.tps': null, 'imu.lat_g': Number.NaN },
      },
    })
    client.emit({ type: 'broadcast', event: 'live', payload: { seq: '0' } })
    const snap = session.snapshot(50)
    expect(snap.channels['engine.rpm'].value).toBe(3000)
    expect(snap.channels['engine.tps']).toBeUndefined()
    expect(snap.diagnostics.rejectedValues).toBe(2)
    expect(snap.diagnostics.invalid).toBe(1)
    expect(snap.diagnostics.accepted).toBe(1)
  })

  it('clears state and the previous listener when the session changes', () => {
    const client = new FakeClient()
    const session = new LiveTelemetrySession({ client, sessionId: SESSION, staleAfterMs: 3_500, now: () => 10 })
    session.start()
    client.emit(live({ 'engine.rpm': 5000 }, 100))
    expect(session.snapshot().channels['engine.rpm'].value).toBe(5000)

    session.replace({ client, sessionId: OTHER, staleAfterMs: 3_500, now: () => 20 })
    expect(client.subs[0].active).toBe(false)
    expect(client.activeCount).toBe(1)
    expect(client.subs[1].topic).toBe(`telemetry:live:${OTHER}`)
    expect(session.snapshot().channels).toEqual({})
    expect(session.snapshot().diagnostics.accepted).toBe(0)

    client.emit(live({ 'engine.rpm': 1 }, 50), 0)
    expect(session.snapshot().channels['engine.rpm']).toBeUndefined()
    client.emit(live({ 'engine.rpm': 2222 }, 80), 1)
    expect(session.snapshot().channels['engine.rpm'].value).toBe(2222)
  })

  it('does not stack listeners when start is called again', () => {
    const client = new FakeClient()
    const session = new LiveTelemetrySession({ client, sessionId: SESSION, staleAfterMs: 3_500, now: () => 1 })
    session.start()
    session.start()
    expect(client.activeCount).toBe(1)
    expect(client.subs[0].active).toBe(false)
    client.emit(live({ 'engine.rpm': 9 }, 3), 0)
    expect(session.snapshot().diagnostics.received).toBe(0)
    client.emit(live({ 'engine.rpm': 9 }, 3), 1)
    expect(session.snapshot().diagnostics.accepted).toBe(1)
  })

  it('maps connection errors and a later resubscribe without a second listener', () => {
    const client = new FakeClient()
    const session = new LiveTelemetrySession({ client, sessionId: SESSION, staleAfterMs: 3_500 })
    session.start()
    client.status('error')
    expect(session.snapshot().status).toBe('error')
    expect(session.snapshot().freshness).toBe('no-data')

    client.status('reconnecting', 'join failed apikey=super-secret-key bearer eyJaaa.bbb.ccc')
    const snap = session.snapshot()
    expect(snap.status).toBe('reconnecting')
    expect(snap.diagnostics.lastError).toContain('[redacted]')
    expect(snap.diagnostics.lastError).not.toContain('super-secret-key')
    expect(snap.diagnostics.lastError).not.toContain('eyJaaa')
    expect(client.activeCount).toBe(1)

    client.status('subscribed')
    expect(session.snapshot().status).toBe('subscribed')
    expect(session.snapshot().diagnostics.lastError).toBeNull()
  })

  it('does not subscribe with a non-UUID session and stops cleanly', () => {
    const client = new FakeClient()
    const session = new LiveTelemetrySession({ client, sessionId: 'not-a-session', staleAfterMs: 3_500 })
    session.start()
    expect(client.subs).toHaveLength(0)
    expect(session.snapshot().status).toBe('misconfigured')
    session.stop()
    expect(session.snapshot().status).toBe('misconfigured')
  })

  it('does not apply messages after unsubscribe', () => {
    const client = new FakeClient()
    const session = new LiveTelemetrySession({ client, sessionId: SESSION, staleAfterMs: 3_500, now: () => 5 })
    session.start()
    const sub = client.subs[0]
    session.stop()
    sub.onMessage(live({ 'engine.rpm': 1 }, 1))
    expect(session.snapshot().diagnostics.received).toBe(0)
  })
})
