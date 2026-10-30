import { describe, expect, it } from 'vitest'
import {
  isPublishableKey,
  isSessionUuid,
  mapSubscribeStatus,
  normalizeSupabaseUrl,
  sanitizeStatusError,
} from './broadcastClient'

describe('broadcast configuration helpers', () => {
  it('normalizes a project URL and drops a pasted apikey query', () => {
    expect(normalizeSupabaseUrl('https://example.supabase.co/realtime/v1/websocket?apikey=secret')).toBe('https://example.supabase.co')
    expect(normalizeSupabaseUrl('not a url')).toBeNull()
    expect(normalizeSupabaseUrl('https://user:pass@example.supabase.co')).toBeNull()
  })

  it('accepts anon and publishable keys and rejects service-role material', () => {
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=+$/, '')
    const anon = btoa(JSON.stringify({ role: 'anon' })).replace(/=+$/, '')
    const service = btoa(JSON.stringify({ role: 'service_role' })).replace(/=+$/, '')
    expect(isPublishableKey(`${header}.${anon}.sig`)).toBe(true)
    expect(isPublishableKey(`${header}.${service}.sig`)).toBe(false)
    expect(isPublishableKey('sb_secret_do_not_use_this_key')).toBe(false)
    expect(isPublishableKey('sb_publishable_example_key_value')).toBe(true)
    expect(isSessionUuid('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isSessionUuid('session')).toBe(false)
  })

  it('maps socket statuses without confusing subscribed and fresh', () => {
    expect(mapSubscribeStatus('SUBSCRIBED', false)).toBe('subscribed')
    expect(mapSubscribeStatus('CHANNEL_ERROR', false)).toBe('error')
    expect(mapSubscribeStatus('CHANNEL_ERROR', true)).toBe('reconnecting')
    expect(mapSubscribeStatus('TIMED_OUT', true)).toBe('reconnecting')
    expect(mapSubscribeStatus('CLOSED', false)).toBe('disconnected')
    expect(mapSubscribeStatus('CLOSED', true)).toBe('reconnecting')
  })

  it('redacts credentials from status errors', () => {
    const text = sanitizeStatusError(new Error('wss://x/?apikey=abcdef bearer eyJaaa.bbb.ccc sb_secret_zzz'))
    expect(text).not.toContain('abcdef')
    expect(text).not.toContain('eyJaaa')
    expect(text).not.toContain('sb_secret_zzz')
    expect(text).toContain('[redacted]')
  })
})
