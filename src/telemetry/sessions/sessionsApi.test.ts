import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SESSION_LIST_LIMIT, endSession, listSessions, parseSession, signInWithPassword, signOut, startSession, validateDeviceId,
} from './sessionsApi'

const ID = '11111111-1111-4111-8111-111111111111'
const ROW = {
  id: ID, name: 'car-1 run', device_id: 'car-1', status: 'running',
  started_at: '2026-11-07T18:00:00Z', ended_at: null, created_at: '2026-11-07T18:00:00Z',
}
const PARSED = {
  id: ID, name: 'car-1 run', deviceId: 'car-1', status: 'running',
  startedAt: '2026-11-07T18:00:00Z', endedAt: null, createdAt: '2026-11-07T18:00:00Z',
}

function fakeClient(result: { data: unknown; error: { message: string } | null } = { data: ROW, error: null }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  }
  const rpc = vi.fn().mockResolvedValue(result)
  const from = vi.fn().mockReturnValue(query)
  const schema = vi.fn().mockReturnValue({ rpc, from })
  const auth = {
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }
  return { client: { schema, auth } as unknown as SupabaseClient, schema, rpc, from, query, auth }
}

describe('validateDeviceId', () => {
  it('trims and rejects empty or oversize ids', () => {
    expect(validateDeviceId('  car-1 ')).toBe('car-1')
    expect(() => validateDeviceId('   ')).toThrow('1-128')
    expect(() => validateDeviceId('x'.repeat(129))).toThrow('1-128')
  })
})

describe('parseSession', () => {
  it('maps a row and keeps unbound/open fields null', () => {
    expect(parseSession(ROW)).toEqual(PARSED)
    expect(parseSession({ ...ROW, device_id: null, started_at: undefined }).deviceId).toBeNull()
  })
  it.each([null, [], 'x', { ...ROW, id: 'nope' }, { ...ROW, status: 'paused' }, { ...ROW, name: 1 }, { ...ROW, device_id: 5 }, { ...ROW, created_at: null }])(
    'rejects malformed %j', raw => { expect(() => parseSession(raw)).toThrow('Invalid session row') })
})

describe('startSession', () => {
  it('calls telemetry.start_session with the trimmed device and returns the new session', async () => {
    const f = fakeClient()
    await expect(startSession(f.client, ' car-1 ', ' my run ')).resolves.toEqual(PARSED)
    expect(f.schema).toHaveBeenCalledExactlyOnceWith('telemetry')
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('start_session', { p_device_id: 'car-1', p_name: 'my run' })
  })
  it('sends a null name when none is given so the server picks one', async () => {
    const f = fakeClient()
    await startSession(f.client, 'car-1')
    expect(f.rpc).toHaveBeenCalledWith('start_session', { p_device_id: 'car-1', p_name: null })
  })
  it('rejects a blank device before any request', async () => {
    const f = fakeClient()
    await expect(startSession(f.client, '  ')).rejects.toThrow('Device ID')
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('surfaces sanitized RPC errors and rejects a malformed result', async () => {
    await expect(startSession(fakeClient({ data: null, error: { message: 'permission denied apikey=secret' } }).client, 'car-1'))
      .rejects.toThrow('apikey=[redacted]')
    await expect(startSession(fakeClient({ data: { id: 'x' }, error: null }).client, 'car-1')).rejects.toThrow('Invalid session row')
  })
})

describe('endSession', () => {
  it('calls telemetry.end_session with the session id', async () => {
    const f = fakeClient({ data: { ...ROW, status: 'ended', ended_at: '2026-11-07T18:05:00Z' }, error: null })
    const ended = await endSession(f.client, ID)
    expect(ended.status).toBe('ended')
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('end_session', { p_session_id: ID })
  })
  it('rejects a non-UUID before any request', async () => {
    const f = fakeClient()
    await expect(endSession(f.client, '')).rejects.toThrow('No session selected')
    expect(f.rpc).not.toHaveBeenCalled()
  })
})

describe('listSessions', () => {
  it('lists device-bound sessions newest first, bounded, and filters by device when given', async () => {
    const f = fakeClient({ data: [ROW], error: null })
    await expect(listSessions(f.client, { deviceId: ' car-1 ' })).resolves.toEqual([PARSED])
    expect(f.schema).toHaveBeenCalledWith('telemetry')
    expect(f.from).toHaveBeenCalledWith('sessions')
    expect(f.query.not).toHaveBeenCalledWith('device_id', 'is', null)
    expect(f.query.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(f.query.limit).toHaveBeenCalledWith(SESSION_LIST_LIMIT)
    expect(f.query.eq).toHaveBeenCalledExactlyOnceWith('device_id', 'car-1')
  })
  it('does not filter by device when blank and forwards the abort signal', async () => {
    const f = fakeClient({ data: [], error: null })
    const signal = new AbortController().signal
    await listSessions(f.client, { deviceId: ' ', signal })
    expect(f.query.eq).not.toHaveBeenCalled()
    expect(f.query.abortSignal).toHaveBeenCalledWith(signal)
  })
  it('rejects errors, non-arrays and oversized responses', async () => {
    await expect(listSessions(fakeClient({ data: null, error: { message: 'denied' } }).client)).rejects.toThrow('denied')
    await expect(listSessions(fakeClient({ data: {}, error: null }).client)).rejects.toThrow('data array')
    await expect(listSessions(fakeClient({ data: [ROW, ROW], error: null }).client, { limit: 1 })).rejects.toThrow('1-row limit')
  })
})

describe('auth helpers', () => {
  it('signs in with a trimmed email and surfaces sanitized failures', async () => {
    const f = fakeClient()
    await signInWithPassword(f.client, ' a@b.co ', 'pw')
    expect(f.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw' })
    f.auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
    await expect(signInWithPassword(f.client, 'a@b.co', 'bad')).rejects.toThrow('Invalid login credentials')
  })
  it('requires both fields before any request', async () => {
    const f = fakeClient()
    await expect(signInWithPassword(f.client, '', 'pw')).rejects.toThrow('email and password')
    await expect(signInWithPassword(f.client, 'a@b.co', '')).rejects.toThrow('email and password')
    expect(f.auth.signInWithPassword).not.toHaveBeenCalled()
  })
  it('signs out', async () => {
    const f = fakeClient()
    await signOut(f.client)
    expect(f.auth.signOut).toHaveBeenCalledOnce()
  })
})
