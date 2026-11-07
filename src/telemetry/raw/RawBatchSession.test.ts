import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionFreshness } from '../live/mergeChannelState'
import { rawChannelsToFrame } from './mapRawToFrame'
import {
  RAW_BOOTSTRAP_LIMIT,
  RAW_EMPTY_DIAGNOSTICS,
  RAW_FETCH_TIMEOUT_MS,
  RAW_MAX_BATCH_FRAMES,
  RAW_PAGE_LIMIT,
  RAW_POLL_INTERVAL_MS,
  RawBatchSession,
  type RawBatchClient,
  type RawBatchSessionOptions,
  type RawBatchSnapshot,
} from './RawBatchSession'

const SESSION = '11111111-1111-4111-8111-111111111111'
const OTHER_SESSION = '22222222-2222-4222-8222-222222222222'
const SAMPLE_MS = 1735500000123
const NOW = SAMPLE_MS + 10_000
const REAL_FRAME = { can_id: 256, extd: false, dlc: 8, data: '0102030405060708', ts_ms: SAMPLE_MS }
const ENGINE_FRAME = { ...REAL_FRAME, can_id: 1000, data: '001770283201c200' }

function batch(id: string | number = '1', overrides: Record<string, unknown> = {}) {
  return {
    id,
    session_id: SESSION,
    seq: 10,
    dropped_frames: 0,
    frames: [{ ...REAL_FRAME }],
    received_at: new Date(NOW).toISOString(),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const sessions: RawBatchSession[] = []
function setup(pages: unknown[][] = [], options: Partial<RawBatchSessionOptions> = {}) {
  const fetchPage = vi.fn<RawBatchClient['fetchPage']>().mockResolvedValue([])
  for (const page of pages) fetchPage.mockResolvedValueOnce(page)
  const session = new RawBatchSession({
    client: { fetchPage }, sessionId: SESSION, staleAfterMs: 3_500, now: () => NOW, ...options,
  })
  sessions.push(session)
  return { session, fetchPage }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  for (const session of sessions) session.stop()
  sessions.length = 0
  vi.useRealTimers()
})

describe('RawBatchSession', () => {
  it('starts idle, bootstraps oldest-to-newest and catches up by primary id, not seq', async () => {
    const accepted: RawBatchSnapshot[] = []
    const first = batch(1, { seq: 30, frames: [REAL_FRAME] })
    const second = batch('2', { seq: 31, frames: [{ ...REAL_FRAME, ts_ms: SAMPLE_MS + 1 }] })
    const reboot = batch('3', { seq: 0, frames: [{ ...REAL_FRAME, ts_ms: SAMPLE_MS + 2 }] })
    const { session, fetchPage } = setup([[first, second], [reboot]], { onAccepted: snapshot => accepted.push(snapshot) })
    expect(session.snapshot()).toMatchObject({ status: 'idle', channels: {}, sessionStartUs: null, rawReadings: [], diagnostics: RAW_EMPTY_DIAGNOSTICS })
    const listener = vi.fn()
    const unsubscribe = session.subscribe(listener)
    session.start()
    expect(session.snapshot().status).toBe('connecting')
    await settle()
    expect(accepted.map(snapshot => snapshot.diagnostics.lastBatchId)).toEqual(['1', '2'])
    expect(accepted[0].channels.rate_lpm_1.value).toBeCloseTo(2.58, 6)
    expect(accepted[0].channels.total_volume_l_1.value).toBe(50595.08203125)
    expect(accepted[0].channels.rate_lpm_1.tUs).toBe(SAMPLE_MS * 1_000)
    expect(session.snapshot().sessionStartUs).toBe(SAMPLE_MS * 1_000)
    expect(fetchPage.mock.calls[0][0]).toMatchObject({ afterId: null, signal: expect.any(AbortSignal) })
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(fetchPage.mock.calls[1][0].afterId).toBe('2')
    expect(session.snapshot().diagnostics).toMatchObject({
      receivedBatches: 3, received: 3, decodedFrames: 3, accepted: 3, lastSeq: 0, lastBatchId: '3',
      latestSampleUs: (SAMPLE_MS + 2) * 1_000, lastSendTimestampMs: null, uplinkEstimateMs: null,
    })
    expect(session.snapshot().sessionStartUs).toBe(SAMPLE_MS * 1_000)
    expect(listener.mock.calls[listener.mock.calls.length - 1][0].status).toBe('connected')
    expect(accepted[0].diagnostics).toMatchObject({ received: 1, receivedBatches: 1, lastBatchId: '1' })
    unsubscribe()
    const count = listener.mock.calls.length
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(listener).toHaveBeenCalledTimes(count)
    expect(session.snapshot().diagnostics.lastError).toBeNull()
  })

  it('yields at 0ms after full bootstrap and catch-up pages, otherwise waits 1s', async () => {
    const B = RAW_BOOTSTRAP_LIMIT, P = RAW_PAGE_LIMIT
    const bootstrap = Array.from({ length: B }, (_, i) => batch(i + 1, { frames: [] }))
    const catchup = Array.from({ length: P }, (_, i) => batch(i + B + 1, { frames: [] }))
    const { session, fetchPage } = setup([bootstrap, catchup, [batch(B + P + 1, { frames: [] })]])
    session.start()
    await settle()
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    await vi.runOnlyPendingTimersAsync()
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls[1][0].afterId).toBe(String(B))
    await vi.runOnlyPendingTimersAsync()
    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(fetchPage.mock.calls[2][0].afterId).toBe(String(B + P))
    expect(session.snapshot().diagnostics.receivedBatches).toBe(B + P + 1)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchPage).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPage.mock.calls[3][0].afterId).toBe(String(B + P + 1))
  })

  it('never overlaps slow requests and aborts without emitting late resolutions', async () => {
    const pending = deferred<unknown[]>()
    const { session, fetchPage } = setup()
    fetchPage.mockReturnValueOnce(pending.promise)
    const listener = vi.fn()
    session.subscribe(listener)
    session.start()
    const signal = fetchPage.mock.calls[0][0].signal
    await vi.advanceTimersByTimeAsync(RAW_FETCH_TIMEOUT_MS - 1)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    session.stop()
    expect(vi.getTimerCount()).toBe(0)
    const calls = listener.mock.calls.length
    expect(signal.aborted).toBe(true)
    pending.resolve([batch()])
    await settle()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(listener).toHaveBeenCalledTimes(calls)
    expect(session.snapshot().diagnostics.received).toBe(0)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['resolve', 'reject'] as const)('times out stalled requests, retries the same cursor, and ignores a late %s', async completion => {
    const pending = deferred<unknown[]>()
    const onAccepted = vi.fn()
    const { session, fetchPage } = setup([[batch(9)]], { onAccepted })
    fetchPage.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([
      batch(10, { frames: [{ ...REAL_FRAME, ts_ms: SAMPLE_MS + 1 }] }),
    ])
    const listener = vi.fn()
    session.subscribe(listener)
    session.start()
    await settle()
    // A successful request leaves only the next poll timer, not a deadline timer.
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    const expiredSignal = fetchPage.mock.calls[1][0].signal
    await vi.advanceTimersByTimeAsync(RAW_FETCH_TIMEOUT_MS - 1)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(expiredSignal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(expiredSignal.aborted).toBe(true)
    expect(session.snapshot().status).toBe('error')
    expect(session.snapshot().diagnostics).toMatchObject({ lastBatchId: '9', receivedBatches: 1 })
    expect(session.snapshot().diagnostics.lastError).toBe(`Raw batch fetch timed out after ${RAW_FETCH_TIMEOUT_MS}ms`)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS - 1)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPage.mock.calls.map(([options]) => options.afterId)).toEqual([null, '9', '9'])
    const retrySignal = fetchPage.mock.calls[2][0].signal
    expect(retrySignal).not.toBe(expiredSignal)
    expect(retrySignal.aborted).toBe(false)
    expect(session.snapshot().status).toBe('connected')
    expect(session.snapshot().diagnostics).toMatchObject({ receivedBatches: 2, lastBatchId: '10', lastError: null })
    const before = session.snapshot()
    const notifications = listener.mock.calls.length
    if (completion === 'resolve') pending.resolve([batch(99, { dropped_frames: 999 })])
    else pending.reject(new Error('expired fetch failed apikey=secret'))
    await settle()
    expect(session.snapshot()).toEqual(before)
    expect(listener).toHaveBeenCalledTimes(notifications)
    expect(onAccepted).toHaveBeenCalledTimes(2)
    expect(retrySignal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    session.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(RAW_FETCH_TIMEOUT_MS * 2)
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('removes deadline and abort-listener cleanup when a request fails before its timeout', async () => {
    const { session, fetchPage } = setup()
    fetchPage.mockRejectedValueOnce(new Error('offline'))
    session.start()
    const signal = fetchPage.mock.calls[0][0].signal
    await settle()
    expect(session.snapshot().status).toBe('error')
    expect(vi.getTimerCount()).toBe(1)
    session.stop()
    expect(vi.getTimerCount()).toBe(0)
    // A settled request no longer listens to session abort.
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(RAW_FETCH_TIMEOUT_MS * 2)
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it.each(['resolve', 'reject'] as const)('ignores a late %s from a stopped generation after restart', async completion => {
    const pending = deferred<unknown[]>()
    const onAccepted = vi.fn()
    const { session, fetchPage } = setup([], { onAccepted })
    fetchPage.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([batch(9)])
    session.start()
    const oldSignal = fetchPage.mock.calls[0][0].signal
    session.start()
    await settle()
    expect(oldSignal.aborted).toBe(true)
    expect(fetchPage.mock.calls[1][0].afterId).toBeNull()
    if (completion === 'resolve') pending.resolve([batch(1, { dropped_frames: 99 })])
    else pending.reject(new Error('obsolete request failed'))
    await settle()
    expect(session.snapshot().diagnostics).toMatchObject({ receivedBatches: 1, droppedFrames: 0, lastBatchId: '9', lastError: null })
    expect(session.snapshot().status).toBe('connected')
    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('resets all samples, cursor, counters, start time, and errors on start', async () => {
    const { session, fetchPage } = setup([[batch(1, { dropped_frames: 4, frames: [ENGINE_FRAME, { ...REAL_FRAME, can_id: 881 }] })]])
    session.start()
    await settle()
    const oldSnapshot = session.snapshot()
    expect(oldSnapshot.diagnostics.accepted).toBe(2)
    const next = deferred<unknown[]>()
    fetchPage.mockReturnValueOnce(next.promise)
    session.start()
    expect(session.snapshot()).toMatchObject({ status: 'connecting', channels: {}, rawReadings: [], sessionStartUs: null, diagnostics: RAW_EMPTY_DIAGNOSTICS })
    expect(fetchPage.mock.calls[1][0].afterId).toBeNull()
    next.resolve([batch(2, { frames: [{ ...REAL_FRAME, ts_ms: SAMPLE_MS + 100 }] })])
    await settle()
    expect(session.snapshot().channels.r_engine).toBeUndefined()
    expect(session.snapshot().sessionStartUs).toBe((SAMPLE_MS + 100) * 1_000)
    expect(oldSnapshot.channels.r_engine.value).toBe(6000)
    expect(oldSnapshot.diagnostics.droppedFrames).toBe(4)
    session.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries sanitized transient errors after 1s without advancing the cursor', async () => {
    const { session, fetchPage } = setup([[batch(1)]])
    fetchPage.mockRejectedValueOnce(new Error('query failed apikey=secret bearer eyJaaa.bbb.ccc sb_secret_zzz'))
      .mockResolvedValueOnce([batch(2, { frames: [{ ...REAL_FRAME, ts_ms: SAMPLE_MS + 1 }] })])
    session.start()
    await settle()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(session.snapshot().status).toBe('error')
    expect(session.snapshot().diagnostics.lastError).toContain('[redacted]')
    expect(session.snapshot().diagnostics.lastError).not.toMatch(/apikey=secret|eyJaaa|sb_secret_zzz/)
    expect(session.snapshot().diagnostics.lastBatchId).toBe('1')
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPage.mock.calls.map(([options]) => options.afterId)).toEqual([null, '1', '1'])
    expect(session.snapshot().status).toBe('connected')
    expect(session.snapshot().diagnostics.lastError).toBeNull()
    expect(session.snapshot().diagnostics.receivedBatches).toBe(2)
  })

  it('reports connected with a cautious SELECT RLS/device-filter warning on empty initial reads', async () => {
    const { session, fetchPage } = setup([[], [batch(1)]])
    session.start()
    await settle()
    const snapshot = session.snapshot()
    expect(snapshot.status).toBe('connected')
    expect(snapshot.channels).toEqual({})
    expect(snapshot.diagnostics.lastAcceptedMs).toBeNull()
    expect(snapshot.diagnostics.lastError).toMatch(/No rows visible.*signed in.*RLS/)
    expect(snapshot.diagnostics.lastError).toContain('no batches yet')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchPage.mock.calls[1][0].afterId).toBeNull()
    expect(session.snapshot().diagnostics.lastError).toBeNull()
  })

  it('does not make historical bootstrap data fresh and caps future server receipts at local now', async () => {
    const historicalReceipt = NOW - 86_400_000
    const { session } = setup([[batch(1, { received_at: new Date(historicalReceipt).toISOString() })], [
      batch(2, { received_at: new Date(NOW + 99_000).toISOString(), frames: [{ ...REAL_FRAME, ts_ms: SAMPLE_MS + 1 }] }),
    ]])
    session.start()
    await settle()
    expect(session.snapshot().diagnostics.lastAcceptedMs).toBe(historicalReceipt)
    expect(session.snapshot().channels.rate_lpm_1.receivedAtMs).toBe(historicalReceipt)
    expect(sessionFreshness(session.snapshot().channels, NOW, 3_500)).toBe('stale')
    expect(session.snapshot().diagnostics).toMatchObject({ lastReceiptMs: NOW, sampleAgeEstimateMs: 10_000, uplinkEstimateMs: null, lastSendTimestampMs: null })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(session.snapshot().diagnostics.lastAcceptedMs).toBe(NOW)
    expect(session.snapshot().channels.rate_lpm_1.receivedAtMs).toBe(NOW)
  })

  it('ignores duplicate primary ids, counts drops once, and old samples cannot freshen channels', async () => {
    let now = NOW
    const first = batch(1, { dropped_frames: 3 })
    const { session } = setup([[first, first], [
      first,
      batch(2, { dropped_frames: 2 }),
      batch(3, { frames: [{ ...REAL_FRAME, ts_ms: SAMPLE_MS - 1 }] }),
    ]], { now: () => now })
    session.start()
    await settle()
    const before = session.snapshot()
    now += 10_000
    await vi.advanceTimersByTimeAsync(1_000)
    const snapshot = session.snapshot()
    expect(snapshot.diagnostics).toMatchObject({ receivedBatches: 3, received: 3, accepted: 1, ignoredOld: 4, droppedFrames: 5, lastBatchId: '3', lastAcceptedMs: NOW })
    expect(snapshot.channels).toEqual(before.channels)
    expect(snapshot.sessionStartUs).toBe(before.sessionStartUs)
    expect(sessionFreshness(snapshot.channels, now, 3_500)).toBe('stale')
  })

  it('decodes shared config without inventing dashboard samples for unknown or invalid frames', async () => {
    const { session } = setup([[batch(1, { frames: [
      null,
      { ...REAL_FRAME, data: 'bad' },
      { ...REAL_FRAME, ts_ms: Number.MAX_SAFE_INTEGER },
      { ...REAL_FRAME, can_id: 42 },
      { ...ENGINE_FRAME, data: 'ff00000000000000' },
      { ...ENGINE_FRAME, dlc: 0, data: '' },
      { ...REAL_FRAME, dlc: 0, data: '' },
    ] })]])
    session.start()
    await settle()
    const snapshot = session.snapshot()
    expect(snapshot.channels).toEqual({})
    expect(snapshot.rawReadings).toEqual([])
    expect(snapshot.sessionStartUs).toBeNull()
    expect(snapshot.diagnostics).toMatchObject({ received: 7, invalid: 3, decodedFrames: 4, unknownFrames: 3, accepted: 0, skippedSignals: 2, rejectedValues: 2, lastAcceptedMs: null })
    expect(rawChannelsToFrame(snapshot.channels, snapshot.sessionStartUs).unavailableFields).toContain('rpm')
  })

  it('merges partial frames per channel, preserves missing channels, and fixes session start at first acceptance', async () => {
    const onAccepted = vi.fn()
    const { session } = setup([[batch(1, { frames: [
      ENGINE_FRAME,
      { ...ENGINE_FRAME, data: '0164500301020000', ts_ms: SAMPLE_MS - 100 },
      { ...ENGINE_FRAME, data: 'ff00000000000000', ts_ms: SAMPLE_MS + 1 },
      { ...ENGINE_FRAME, ts_ms: SAMPLE_MS },
    ] })]], { onAccepted })
    session.start()
    await settle()
    const snapshot = session.snapshot()
    expect(snapshot.channels.r_engine.value).toBe(6000)
    expect(snapshot.channels['%_TPS'].value).toBe(80)
    expect(snapshot.channels['%_TPS'].tUs).toBe((SAMPLE_MS - 100) * 1_000)
    expect(snapshot.sessionStartUs).toBe((SAMPLE_MS - 100) * 1_000)
    expect(snapshot.diagnostics).toMatchObject({ received: 4, accepted: 2, ignoredOld: 4, unknownFrames: 1 })
    expect(onAccepted).toHaveBeenCalledTimes(2)
    expect(rawChannelsToFrame(snapshot.channels, snapshot.sessionStartUs).frame).toMatchObject({ rpm: 6000, throttle: 80, gear: 3, coolant: 90, oilTemp: 100 })
  })

  it('preserves unsafe eight-byte hex with timestamp guards, never coercing it into numeric state', async () => {
    const opaque = { ...REAL_FRAME, can_id: 881, data: 'FFffFFffFFffFFff' }
    const onAccepted = vi.fn()
    let now = NOW
    const { session } = setup([[batch(1, { frames: [opaque] })], [batch(2, { received_at: new Date(NOW + 10_000).toISOString(), frames: [
      { ...opaque, data: '0000000000000000', ts_ms: SAMPLE_MS - 1 },
      opaque,
    ] })]], { onAccepted, now: () => now })
    session.start()
    await settle()
    expect(session.snapshot().channels).toEqual({})
    expect(session.snapshot().rawReadings).toEqual([{ id: 'FLT_TTA', hex: opaque.data, tUs: SAMPLE_MS * 1_000 }])
    expect(session.snapshot().diagnostics).toMatchObject({ accepted: 1, skippedSignals: 1, rejectedValues: 1 })
    now += 10_000
    await vi.advanceTimersByTimeAsync(1_000)
    expect(session.snapshot().rawReadings[0].hex).toBe(opaque.data)
    expect(session.snapshot().diagnostics.lastAcceptedMs).toBe(NOW)
    expect(session.snapshot().channels.FLT_TTA).toBeUndefined()
    expect(session.snapshot().diagnostics.ignoredOld).toBe(2)
    expect(onAccepted).toHaveBeenCalledTimes(1)
  })

  it('removes superseded numeric state for newer opaque values and rejects old values in either representation', async () => {
    const safe = { ...REAL_FRAME, can_id: 881, data: '0100000000000000' }
    const opaque = { ...safe, data: 'FFffFFffFFffFFff', ts_ms: SAMPLE_MS + 2 }
    const latestSafe = { ...safe, data: '0300000000000000', ts_ms: SAMPLE_MS + 4 }
    const accepted: RawBatchSnapshot[] = []
    const { session } = setup([
      [batch(1, { frames: [safe] })],
      [batch(2, { frames: [opaque] })],
      [batch(3, { frames: [{ ...safe, ts_ms: SAMPLE_MS + 1 }] })],
      [batch(4, { frames: [latestSafe] })],
      [batch(5, { frames: [{ ...opaque, ts_ms: SAMPLE_MS + 3 }] })],
    ], { onAccepted: snapshot => accepted.push(snapshot) })
    session.start()
    await settle()
    expect(session.snapshot().channels.FLT_TTA.value).toBe(1)
    const retained = session.snapshot()
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(session.snapshot().channels.FLT_TTA).toBeUndefined()
    expect(session.snapshot().rawReadings).toEqual([{ id: 'FLT_TTA', hex: opaque.data, tUs: opaque.ts_ms * 1_000 }])
    expect(session.snapshot().diagnostics).toMatchObject({ accepted: 2, skippedSignals: 1, latestSampleUs: opaque.ts_ms * 1_000 })
    expect(accepted[1].channels.FLT_TTA).toBeUndefined()
    expect(retained.channels.FLT_TTA.value).toBe(1)
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(session.snapshot().channels.FLT_TTA).toBeUndefined()
    expect(session.snapshot().diagnostics).toMatchObject({ accepted: 2, ignoredOld: 1 })
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    const newest = session.snapshot()
    expect(newest.channels.FLT_TTA).toMatchObject({ value: 3, tUs: latestSafe.ts_ms * 1_000 })
    expect(newest.rawReadings[0].hex).toBe(latestSafe.data)
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(session.snapshot().channels).toEqual(newest.channels)
    expect(session.snapshot().rawReadings).toEqual(newest.rawReadings)
    expect(session.snapshot().diagnostics).toMatchObject({ accepted: 3, ignoredOld: 2, lastAcceptedMs: newest.diagnostics.lastAcceptedMs })
    expect(accepted).toHaveLength(3)
  })

  it.each([false, true])('keeps stable equal-timestamp ordering between numeric and opaque frames (opaque first: %s)', async opaqueFirst => {
    const safe = { ...REAL_FRAME, can_id: 881, data: '0100000000000000' }
    const opaque = { ...safe, data: 'ffffffffffffffff' }
    const frames = opaqueFirst ? [opaque, safe] : [safe, opaque]
    const { session } = setup([[batch(1, { frames })]])
    session.start()
    await settle()
    const snapshot = session.snapshot()
    expect(snapshot.channels.FLT_TTA?.value).toBe(opaqueFirst ? undefined : 1)
    expect(snapshot.rawReadings[0].hex).toBe(frames[0].data)
    expect(snapshot.diagnostics).toMatchObject({ received: 2, decodedFrames: 2, accepted: 1, ignoredOld: 1, skippedSignals: 1 })
  })

  it('stably sorts unordered batches before accepting samples, keeps malformed frames counted, and displays monotonic time', async () => {
    const frames = [
      { ...ENGINE_FRAME, ts_ms: SAMPLE_MS + 2_000 },
      null,
      { ...REAL_FRAME, ts_ms: SAMPLE_MS - 500 },
      { ...REAL_FRAME, ts_ms: 'invalid' },
      ENGINE_FRAME,
      { ...ENGINE_FRAME, ts_ms: SAMPLE_MS - 1_000, data: 'bad' },
      { ...REAL_FRAME, ts_ms: -1 },
      { ...ENGINE_FRAME },
    ]
    const original = [...frames]
    const accepted: RawBatchSnapshot[] = []
    const { session } = setup([[batch(1, { frames })], [batch(2, { frames: [
      { ...ENGINE_FRAME, ts_ms: SAMPLE_MS + 1_500 },
    ] })]], { onAccepted: snapshot => accepted.push(snapshot) })
    session.start()
    await settle()
    const snapshot = session.snapshot()
    expect(snapshot.sessionStartUs).toBe((SAMPLE_MS - 500) * 1_000)
    expect(snapshot.channels.r_engine.tUs).toBe((SAMPLE_MS + 2_000) * 1_000)
    expect(snapshot.diagnostics).toMatchObject({ received: 8, invalid: 4, decodedFrames: 4, accepted: 3, ignoredOld: 4 })
    expect(accepted.map(value => rawChannelsToFrame(value.channels, value.sessionStartUs).frame.t)).toEqual([0, 0.5, 2.5])
    expect(frames).toEqual(original)
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(session.snapshot().channels).toEqual(snapshot.channels)
    expect(session.snapshot().sessionStartUs).toBe(snapshot.sessionStartUs)
    expect(session.snapshot().diagnostics).toMatchObject({ accepted: 3, ignoredOld: 8 })
    expect(accepted).toHaveLength(3)
  })

  it('sorts a newer opaque sample after an older number even when the opaque frame arrives first', async () => {
    const safe = { ...REAL_FRAME, can_id: 881, data: '0100000000000000' }
    const opaque = { ...safe, data: 'ffffffffffffffff', ts_ms: SAMPLE_MS + 1 }
    const accepted: RawBatchSnapshot[] = []
    const { session } = setup([[batch(1, { frames: [opaque, safe] })]], { onAccepted: value => accepted.push(value) })
    session.start()
    await settle()
    expect(accepted).toHaveLength(2)
    expect(accepted[0].channels.FLT_TTA.value).toBe(1)
    expect(accepted[1].channels.FLT_TTA).toBeUndefined()
    expect(session.snapshot().sessionStartUs).toBe(SAMPLE_MS * 1_000)
    expect(session.snapshot().rawReadings[0].tUs).toBe(opaque.ts_ms * 1_000)
  })

  it('never regresses lastAcceptedMs on a newer primary id with an older server receipt', async () => {
    let now = NOW
    const { session } = setup([
      [batch(1, { received_at: new Date(NOW - 100).toISOString() })],
      [batch(2, { received_at: new Date(NOW - 10_000).toISOString(), frames: [{ ...REAL_FRAME, ts_ms: SAMPLE_MS + 1 }] })],
      [batch(3, { received_at: new Date(NOW + 100_000).toISOString(), frames: [{ ...REAL_FRAME, ts_ms: SAMPLE_MS + 2 }] })],
      [batch(4, { received_at: new Date(NOW - 500).toISOString(), frames: [{ ...REAL_FRAME, ts_ms: SAMPLE_MS + 3 }] })],
    ], { now: () => now })
    session.start()
    await settle()
    expect(session.snapshot().diagnostics.lastAcceptedMs).toBe(NOW - 100)
    now += 1_000
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(session.snapshot().diagnostics).toMatchObject({ accepted: 2, lastAcceptedMs: NOW - 100, lastBatchId: '2' })
    expect(session.snapshot().channels.rate_lpm_1.receivedAtMs).toBe(NOW - 10_000)
    now += 1_000
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(session.snapshot().diagnostics.lastAcceptedMs).toBe(now)
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(session.snapshot().diagnostics).toMatchObject({ accepted: 4, lastAcceptedMs: now, lastBatchId: '4' })
    expect(session.snapshot().channels.rate_lpm_1.receivedAtMs).toBe(NOW - 500)
  })

  it('copies snapshots deeply enough to protect retained history and internal state', async () => {
    const { session } = setup([[batch(1, { frames: [ENGINE_FRAME, { ...REAL_FRAME, can_id: 881 }] })]])
    session.start()
    await settle()
    const snapshot = session.snapshot()
    snapshot.channels.r_engine.value = -999
    snapshot.rawReadings[0].hex = 'corrupt'
    snapshot.diagnostics.received = -99
    snapshot.diagnostics.groupsSeen.push(1)
    expect(session.snapshot().channels.r_engine.value).toBe(6000)
    expect(session.snapshot().rawReadings[0].hex).toBe(REAL_FRAME.data)
    expect(session.snapshot().diagnostics.received).toBe(2)
    expect(session.snapshot().diagnostics.groupsSeen).toEqual([])
    expect(RAW_EMPTY_DIAGNOSTICS.received).toBe(0)
  })

  it('partitions by session and rejects wrong-session rows without consuming earlier rows', async () => {
    const { session, fetchPage } = setup([[batch(1), batch(2, { session_id: OTHER_SESSION })], [batch(1)]])
    const other = setup([[batch(50, { session_id: OTHER_SESSION, frames: [ENGINE_FRAME] })]], { sessionId: OTHER_SESSION }).session
    session.start()
    other.start()
    await settle()
    expect(session.snapshot().status).toBe('error')
    expect(session.snapshot().channels).toEqual({})
    expect(session.snapshot().diagnostics.lastBatchId).toBeNull()
    expect(other.snapshot().sessionId).toBe(OTHER_SESSION)
    expect(other.snapshot().channels.r_engine.value).toBe(6000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchPage.mock.calls[1][0].afterId).toBeNull()
    expect(session.snapshot().channels.r_engine).toBeUndefined()
    expect(session.snapshot().channels.rate_lpm_1).toBeDefined()
  })

  it('keeps exact bigint cursors beyond Number.MAX_SAFE_INTEGER', async () => {
    const { session, fetchPage } = setup([[batch('9007199254740992'), batch('9007199254740993')], [batch('9223372036854775807')]])
    session.start()
    await settle()
    expect(session.snapshot().diagnostics.receivedBatches).toBe(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchPage.mock.calls[1][0].afterId).toBe('9007199254740993')
    expect(session.snapshot().diagnostics.lastBatchId).toBe('9223372036854775807')
  })

  it.each([
    ['unsafe numeric id', { id: 9007199254740992 }],
    ['fractional id', { id: 1.5 }],
    ['negative id', { id: '-1' }],
    ['oversized id', { id: '9223372036854775808' }],
    ['nondecimal id', { id: '1e2' }],
    ['missing id', { id: undefined }],
    ['unsafe seq', { seq: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative seq', { seq: -1 }],
    ['string seq', { seq: '1' }],
    ['negative dropped count', { dropped_frames: -1 }],
    ['fractional dropped count', { dropped_frames: 1.5 }],
    ['missing dropped count', { dropped_frames: undefined }],
    ['non-array frames', { frames: {} }],
    ['unbounded frames', { frames: Array(RAW_MAX_BATCH_FRAMES + 1).fill(null) }],
    ['null receipt', { received_at: null }],
    ['invalid receipt', { received_at: 'not-a-time' }],
  ])('rejects %s without cursor advancement', async (_name, overrides) => {
    const { session, fetchPage } = setup([[batch(1), batch(2, overrides)]])
    session.start()
    await settle()
    expect(session.snapshot().status).toBe('error')
    expect(session.snapshot().diagnostics.receivedBatches).toBe(0)
    expect(session.snapshot().diagnostics.lastBatchId).toBeNull()
    expect(session.snapshot().diagnostics.lastError).toContain('Invalid raw batch')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchPage.mock.calls[1][0].afterId).toBeNull()
  })

  it.each([false, true])('rejects an oversized page atomically and retries the same cursor (catch-up: %s)', async catchup => {
    const limit = catchup ? RAW_PAGE_LIMIT : RAW_BOOTSTRAP_LIMIT
    const oversized = Array.from({ length: limit + 1 }, (_, index) => batch(index + 2, { frames: [] }))
    const { session, fetchPage } = setup(catchup ? [[batch(1)], oversized] : [oversized])
    session.start()
    await settle()
    if (catchup) await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(session.snapshot().status).toBe('error')
    expect(session.snapshot().diagnostics).toMatchObject({ receivedBatches: catchup ? 1 : 0, lastBatchId: catchup ? '1' : null })
    expect(session.snapshot().diagnostics.lastError).toContain(`${limit}-row limit`)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(fetchPage.mock.calls[fetchPage.mock.calls.length - 1][0].afterId).toBe(catchup ? '1' : null)
  })

  it('waits 1s instead of spinning on a full page that makes no cursor progress', async () => {
    const first = batch(1)
    const repeated = Array.from({ length: RAW_PAGE_LIMIT }, () => first)
    const { session, fetchPage } = setup([[first], repeated])
    session.start()
    await settle()
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(session.snapshot().diagnostics.receivedBatches).toBe(1)
    await vi.advanceTimersByTimeAsync(RAW_POLL_INTERVAL_MS - 1)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('rejects descending ids rather than silently dropping data', async () => {
    const { session } = setup([[batch(2), batch(1)]])
    session.start()
    await settle()
    expect(session.snapshot().diagnostics).toMatchObject({ receivedBatches: 0, lastBatchId: null })
    expect(session.snapshot().diagnostics.lastError).toContain('ascending')
  })

  it.each([null, {}, [null]])('rejects malformed client page %s', async page => {
    const { session, fetchPage } = setup()
    fetchPage.mockResolvedValueOnce(page as unknown[])
    session.start()
    await settle()
    expect(session.snapshot().status).toBe('error')
    expect(session.snapshot().diagnostics.receivedBatches).toBe(0)
  })

  it('handles synchronous client failures as retryable errors', async () => {
    const { session, fetchPage } = setup()
    fetchPage.mockImplementationOnce(() => { throw new Error('offline') })
    session.start()
    await settle()
    expect(session.snapshot().status).toBe('error')
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(session.snapshot().status).toBe('connected')
  })

  it('honors stop inside an acceptance callback before any downstream frame or listener', async () => {
    const onAccepted = vi.fn(() => session.stop())
    const { session } = setup([[batch(1, { frames: [REAL_FRAME, ENGINE_FRAME] })]], { onAccepted })
    const listener = vi.fn()
    session.subscribe(listener)
    session.start()
    const calls = listener.mock.calls.length
    await settle()
    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(session.snapshot().diagnostics.received).toBe(1)
    expect(session.snapshot().channels.r_engine).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(calls)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honors stop from a status subscriber before fetching or notifying later subscribers', () => {
    const { session, fetchPage } = setup()
    session.subscribe(snapshot => { if (snapshot.status === 'connecting') session.stop() })
    const later = vi.fn()
    session.subscribe(later)
    session.start()
    expect(fetchPage).not.toHaveBeenCalled()
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('honors stop during a misconfiguration notification too', () => {
    const { session, fetchPage } = setup([], { sessionId: '' })
    session.subscribe(snapshot => { if (snapshot.status === 'misconfigured') session.stop() })
    const later = vi.fn()
    session.subscribe(later)
    session.start()
    expect(later).toHaveBeenCalledTimes(1)
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it.each([
    { sessionId: ' ' }, { staleAfterMs: 0 }, { staleAfterMs: -1 }, { staleAfterMs: Infinity },
  ])('rejects misconfiguration %s without requests', options => {
    const { session, fetchPage } = setup([], options)
    session.start()
    expect(session.snapshot().status).toBe('misconfigured')
    expect(session.snapshot().diagnostics.lastError).toBeTruthy()
    expect(fetchPage).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
