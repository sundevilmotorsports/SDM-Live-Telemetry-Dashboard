import type { LiveConnectionStatus } from './types'

export type BroadcastStatusHandler = (status: LiveConnectionStatus, error?: string) => void

export interface BroadcastSubscription {
  unsubscribe: () => void
}

export interface BroadcastClient {
  subscribe(options: {
    topic: string
    event: string
    isPrivate: boolean
    onMessage: (payload: unknown) => void
    onStatus: BroadcastStatusHandler
  }): BroadcastSubscription
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isSessionUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
}

/**
 * Accept only an http(s) project origin. Query strings, userinfo, and paths are
 * dropped so a pasted realtime URL cannot carry the API key into logs or the socket.
 */
export function normalizeSupabaseUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

/** Reject empty keys and a service-role JWT. Never throws on a malformed token. */
export function isPublishableKey(key: string): boolean {
  const trimmed = key.trim()
  if (trimmed.length < 20) return false
  if (trimmed.startsWith('sb_secret_')) return false
  if (!trimmed.startsWith('eyJ')) return true
  const role = jwtRole(trimmed)
  if (role === null) return false
  return role === 'anon'
}

export function mapSubscribeStatus(
  status: string,
  everSubscribed: boolean,
): LiveConnectionStatus {
  switch (status) {
    case 'SUBSCRIBED':
      return 'subscribed'
    case 'TIMED_OUT':
      return 'reconnecting'
    case 'CLOSED':
      return everSubscribed ? 'reconnecting' : 'disconnected'
    case 'CHANNEL_ERROR':
      return everSubscribed ? 'reconnecting' : 'error'
    default:
      return 'connecting'
  }
}

/** Strip credentials from a client error before it reaches the UI. */
export function sanitizeStatusError(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : 'realtime error'
  return text
    .replace(/apikey=[^&\s]+/gi, 'apikey=[redacted]')
    .replace(/bearer\s+[A-Za-z0-9._\-]+/gi, 'bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, '[redacted]')
    .slice(0, 240)
}

export function publicHost(raw: string): string {
  try {
    return new URL(raw).host || 'unconfigured host'
  } catch {
    return 'unconfigured host'
  }
}

function jwtRole(token: string): string | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = JSON.parse(atob(padded)) as { role?: unknown }
    return typeof json.role === 'string' ? json.role : null
  } catch {
    return null
  }
}
