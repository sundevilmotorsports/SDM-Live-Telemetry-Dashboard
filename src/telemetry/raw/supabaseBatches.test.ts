import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSupabaseClient } from '../live/supabaseBroadcast'
import { RAW_BOOTSTRAP_LIMIT, RAW_PAGE_LIMIT } from './RawBatchSession'
import { createSupabaseBatchClient } from './supabaseBatches'

vi.mock('../live/supabaseBroadcast', () => ({ getSupabaseClient: vi.fn() }))

const URL = 'https://rwbaahoitfipazbyzlkm.supabase.co'
const KEY = 'sb_publishable_test_only_not_a_real_key'
const SESSION = '11111111-1111-4111-8111-111111111111'
const SELECTION = 'id::text,session_id,device_id,seq,dropped_frames,frames,received_at'

function mockQuery(response: { data: unknown; error: { message: string } | null } = { data: [], error: null }) {
  // Only read methods exist on this fake: writes or Realtime calls fail the test.
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockResolvedValue(response),
  }
  const from = vi.fn().mockReturnValue(builder)
  const schema = vi.fn().mockReturnValue({ from })
  const supabase = { schema }
  vi.mocked(getSupabaseClient).mockReturnValue(supabase as unknown as ReturnType<typeof getSupabaseClient>)
  return { ...builder, from, schema }
}

beforeEach(() => { vi.resetAllMocks() })

describe('createSupabaseBatchClient', () => {
  it('reuses the shared anon client and loads the session from its first batch, oldest first', async () => {
    const rows = [{ id: '1' }, { id: '2' }, { id: '3' }]
    const query = mockQuery({ data: rows, error: null })
    const client = createSupabaseBatchClient(URL, KEY, SESSION)
    const signal = new AbortController().signal
    const result = await client.fetchPage({ afterId: null, signal })
    expect(getSupabaseClient).toHaveBeenCalledExactlyOnceWith(URL, KEY)
    expect(query.schema).toHaveBeenCalledExactlyOnceWith('telemetry')
    expect(query.from).toHaveBeenCalledExactlyOnceWith('can_batches')
    expect(query.select).toHaveBeenCalledExactlyOnceWith(SELECTION)
    expect(query.eq).toHaveBeenCalledExactlyOnceWith('session_id', SESSION)
    expect(query.order).toHaveBeenCalledExactlyOnceWith('id', { ascending: true })
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(RAW_BOOTSTRAP_LIMIT)
    expect(query.gt).not.toHaveBeenCalled()
    expect(query.abortSignal).toHaveBeenCalledExactlyOnceWith(signal)
    expect(result).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }])
  })

  it('uses exact text bigint cursor and ascending limit100 after bootstrap, never seq', async () => {
    const rows = [{ id: '9007199254740994', seq: 0 }, { id: '9007199254740995', seq: 1 }]
    const query = mockQuery({ data: rows, error: null })
    const client = createSupabaseBatchClient(URL, KEY, SESSION)
    const signal = new AbortController().signal
    expect(await client.fetchPage({ afterId: '9007199254740993', signal })).toEqual(rows)
    expect(query.select).toHaveBeenCalledWith(SELECTION)
    expect(query.eq).toHaveBeenCalledExactlyOnceWith('session_id', SESSION)
    expect(query.order).toHaveBeenCalledExactlyOnceWith('id', { ascending: true })
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(RAW_PAGE_LIMIT)
    expect(query.gt).toHaveBeenCalledExactlyOnceWith('id', '9007199254740993')
    expect(query.abortSignal).toHaveBeenCalledWith(signal)
  })

  it('binds each client to its own exact session filter and reuses the cached-client entry point', async () => {
    const query = mockQuery()
    const first = createSupabaseBatchClient(URL, KEY, SESSION)
    const other = createSupabaseBatchClient(URL, KEY, 'other-session')
    const signal = new AbortController().signal
    await first.fetchPage({ afterId: null, signal })
    await first.fetchPage({ afterId: '1', signal })
    await other.fetchPage({ afterId: null, signal })
    expect(getSupabaseClient).toHaveBeenCalledTimes(2)
    expect(query.eq.mock.calls).toEqual([['session_id', SESSION], ['session_id', SESSION], ['session_id', 'other-session']])
  })

  it('returns an empty visible result unchanged (the session supplies the RLS warning)', async () => {
    mockQuery()
    const client = createSupabaseBatchClient(URL, KEY, SESSION)
    await expect(client.fetchPage({ afterId: null, signal: new AbortController().signal })).resolves.toEqual([])
  })

  it('throws a sanitized Supabase error even if data is also present', async () => {
    mockQuery({ data: [], error: { message: 'select denied apikey=secret bearer eyJaaa.bbb.ccc sb_secret_private' } })
    const client = createSupabaseBatchClient(URL, KEY, SESSION)
    const failure = client.fetchPage({ afterId: null, signal: new AbortController().signal })
    await expect(failure).rejects.toThrow('select denied')
    await expect(failure).rejects.toThrow('[redacted]')
    await expect(failure).rejects.not.toThrow(/apikey=secret|eyJaaa|sb_secret_private/)
  })

  it.each([null, undefined, {}, 'rows', 123])('rejects malformed data %s rather than treating it as no visible rows', async data => {
    mockQuery({ data, error: null })
    const client = createSupabaseBatchClient(URL, KEY, SESSION)
    await expect(client.fetchPage({ afterId: null, signal: new AbortController().signal })).rejects.toThrow('non-null data array')
  })

  it.each([null, '9007199254740993'])('rejects a response exceeding its query page ceiling (afterId: %s)', async afterId => {
    const limit = afterId === null ? RAW_BOOTSTRAP_LIMIT : RAW_PAGE_LIMIT
    const rows = Array.from({ length: limit + 1 }, (_, index) => ({ id: String(index + 1) }))
    const query = mockQuery({ data: rows, error: null })
    const client = createSupabaseBatchClient(URL, KEY, SESSION)
    await expect(client.fetchPage({ afterId, signal: new AbortController().signal })).rejects.toThrow(`${limit}-row limit`)
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(limit)
    expect(query.select).toHaveBeenCalledExactlyOnceWith(SELECTION)
  })

  it('propagates the exact AbortSignal and sanitizes thrown transport failures', async () => {
    const query = mockQuery()
    const controller = new AbortController()
    query.abortSignal.mockRejectedValueOnce(new Error('fetch aborted apikey=private'))
    const client = createSupabaseBatchClient(URL, KEY, SESSION)
    controller.abort()
    const failure = client.fetchPage({ afterId: null, signal: controller.signal })
    await expect(failure).rejects.toThrow('fetch aborted apikey=[redacted]')
    expect(query.abortSignal).toHaveBeenCalledWith(controller.signal)
  })

  it('does not bypass shared credential validation or construct a second client', () => {
    vi.mocked(getSupabaseClient).mockImplementationOnce(() => { throw new Error('supabase key must be a publishable or anon key') })
    expect(() => createSupabaseBatchClient(URL, KEY, SESSION)).toThrow('publishable or anon key')
  })

  it('rejects an empty session filter before obtaining the client', () => {
    expect(() => createSupabaseBatchClient(URL, KEY, '  ')).toThrow('sessionId must be nonempty')
    expect(getSupabaseClient).not.toHaveBeenCalled()
  })
})
