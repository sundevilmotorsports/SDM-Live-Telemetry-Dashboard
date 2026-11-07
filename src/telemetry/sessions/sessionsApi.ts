import type { SupabaseClient } from '@supabase/supabase-js'
import { isSessionUuid, sanitizeStatusError } from '../live/broadcastClient'

export const SESSION_SCHEMA = 'telemetry'
export const SESSION_LIST_LIMIT = 50
export const DEVICE_ID_MAX = 128

export type SessionStatus = 'created' | 'running' | 'ended' | 'aborted'

export interface TelemetrySession {
  id: string
  name: string
  deviceId: string | null
  status: SessionStatus
  startedAt: string | null
  endedAt: string | null
  createdAt: string
}

const STATUSES: readonly string[] = ['created', 'running', 'ended', 'aborted']
const COLUMNS = 'id,name,device_id,status,started_at,ended_at,created_at'

export function validateDeviceId(raw: string): string {
  const id = raw.trim()
  if (!id || id.length > DEVICE_ID_MAX) throw new Error(`Device ID must be 1-${DEVICE_ID_MAX} characters`)
  return id
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`Invalid session row: ${field} must be a string`)
  return value
}

/** Validates a telemetry.sessions row (or an RPC result) from the API. */
export function parseSession(raw: unknown): TelemetrySession {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid session row: expected an object')
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || !isSessionUuid(row.id)) throw new Error('Invalid session row: id must be a UUID')
  if (typeof row.name !== 'string') throw new Error('Invalid session row: name must be a string')
  if (typeof row.status !== 'string' || !STATUSES.includes(row.status)) throw new Error('Invalid session row: unknown status')
  if (typeof row.created_at !== 'string') throw new Error('Invalid session row: created_at must be a string')
  return {
    id: row.id,
    name: row.name,
    deviceId: nullableString(row.device_id, 'device_id'),
    status: row.status as SessionStatus,
    startedAt: nullableString(row.started_at, 'started_at'),
    endedAt: nullableString(row.ended_at, 'ended_at'),
    createdAt: row.created_at,
  }
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw new Error(sanitizeStatusError(error))
  }
}

export function signInWithPassword(client: SupabaseClient, email: string, password: string): Promise<void> {
  return guarded(async () => {
    if (!email.trim() || !password) throw new Error('Enter an email and password')
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(error.message)
  })
}

export function signOut(client: SupabaseClient): Promise<void> {
  return guarded(async () => {
    const { error } = await client.auth.signOut()
    if (error) throw new Error(error.message)
  })
}

/** Ends any running session for the device and opens a new one (server-side, atomic). */
export function startSession(client: SupabaseClient, deviceId: string, name?: string): Promise<TelemetrySession> {
  return guarded(async () => {
    const device = validateDeviceId(deviceId)
    const { data, error } = await client
      .schema(SESSION_SCHEMA)
      .rpc('start_session', { p_device_id: device, p_name: name?.trim() || null })
    if (error) throw new Error(error.message)
    return parseSession(data)
  })
}

/** Idempotent: ending an already-ended session returns it unchanged. */
export function endSession(client: SupabaseClient, sessionId: string): Promise<TelemetrySession> {
  return guarded(async () => {
    if (!isSessionUuid(sessionId)) throw new Error('No session selected')
    const { data, error } = await client
      .schema(SESSION_SCHEMA)
      .rpc('end_session', { p_session_id: sessionId.trim() })
    if (error) throw new Error(error.message)
    return parseSession(data)
  })
}

/** Newest first. Only device-bound sessions (created by start_session or ingest) are listed. */
export function listSessions(
  client: SupabaseClient,
  options: { deviceId?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<TelemetrySession[]> {
  return guarded(async () => {
    const limit = options.limit ?? SESSION_LIST_LIMIT
    let query = client
      .schema(SESSION_SCHEMA)
      .from('sessions')
      .select(COLUMNS)
      .not('device_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit)
    const device = options.deviceId?.trim()
    if (device) query = query.eq('device_id', device)
    const { data, error } = await (options.signal ? query.abortSignal(options.signal) : query)
    if (error) throw new Error(error.message)
    if (!Array.isArray(data)) throw new Error('Invalid sessions response: expected a data array')
    if (data.length > limit) throw new Error(`Invalid sessions response: exceeds ${limit}-row limit`)
    return data.map(parseSession)
  })
}
