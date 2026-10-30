import type { LiveMessage, ParseFailure, ParseResult } from './types'

/**
 * Unwrap a supabase-js broadcast callback argument.
 *
 * The client delivers the Phoenix broadcast body:
 *   { type: 'broadcast', event: 'live', payload: { seq, send_timestamp_ms, t_us, values } }
 * The inner object is the ingest contract. A raw contract object is also accepted so
 * tests and non-wrapped relays can share this parser.
 */
export function unwrapBroadcast(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const nested = raw.payload
  if (isRecord(nested) && ('values' in nested || 'seq' in nested || 't_us' in nested)) return nested
  if (raw.type === 'broadcast' && 'payload' in raw) return nested
  return raw
}

/**
 * Validate one live broadcast. Does not invent missing channels and does not
 * coerce strings. Integer timestamps must be safe integers so Unix microseconds
 * are not silently rounded; no bitwise truncation is applied.
 *
 * A message with a valid envelope is accepted even if every channel value is
 * rejected. Those values are omitted rather than stored as zero.
 */
export function parseLiveBroadcast(raw: unknown): ParseResult {
  const body = unwrapBroadcast(raw)
  if (!isRecord(body)) return fail('not-object')
  if (!('seq' in body) && !('values' in body) && !('t_us' in body)) return fail('missing-payload')

  if (!isSafeInteger(body.seq) || (body.seq as number) < 0) return fail('seq')
  if (!isSafeInteger(body.send_timestamp_ms) || (body.send_timestamp_ms as number) < 0) return fail('send_timestamp_ms')
  if (!isSafeInteger(body.t_us) || (body.t_us as number) < 0) return fail('t_us')
  if (!isRecord(body.values)) return fail('values')

  const values: Record<string, number> = {}
  let rejectedValueCount = 0
  for (const [id, value] of Object.entries(body.values)) {
    if (id.length === 0) {
      rejectedValueCount++
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      rejectedValueCount++
      continue
    }
    values[id] = value
  }

  const message: LiveMessage = {
    seq: body.seq as number,
    sendTimestampMs: body.send_timestamp_ms as number,
    tUs: body.t_us as number,
    values,
    rejectedValueCount,
  }
  return { ok: true, message }
}

function fail(reason: ParseFailure): ParseResult {
  return { ok: false, reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
