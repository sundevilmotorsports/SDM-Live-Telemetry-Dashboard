import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import {
  isPublishableKey,
  mapSubscribeStatus,
  normalizeSupabaseUrl,
  sanitizeStatusError,
  type BroadcastClient,
  type BroadcastSubscription,
} from './broadcastClient'

interface CachedClient {
  url: string
  key: string
  client: SupabaseClient
}

let cached: CachedClient | null = null

export function getSupabaseClient(url: string, key: string): SupabaseClient {
  const origin = normalizeSupabaseUrl(url)
  if (!origin) throw new Error('invalid supabase url')
  if (!isPublishableKey(key)) throw new Error('supabase key must be a publishable or anon key')
  if (cached && cached.url === origin && cached.key === key.trim()) return cached.client
  if (cached) {
    void cached.client.removeAllChannels()
    void cached.client.realtime.disconnect()
  }
  const client = createClient(origin, key.trim(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  })
  cached = { url: origin, key: key.trim(), client }
  return client
}

/** Test/reset hook. Does not log the URL or key. */
export function resetSupabaseClient(): void {
  if (cached) {
    void cached.client.removeAllChannels()
    void cached.client.realtime.disconnect()
  }
  cached = null
}

/**
 * Production broadcast transport.
 * Topic is `telemetry:live:<uuid>` — the client adds the realtime: wire prefix itself.
 * `private: false` matches the working Python subscriber. Do not flip this without a
 * matching Realtime policy; this client does not change backend policies.
 */
export function createSupabaseBroadcastClient(url: string, key: string): BroadcastClient {
  const supabase = getSupabaseClient(url, key)
  return {
    subscribe({ topic, event, isPrivate, onMessage, onStatus }): BroadcastSubscription {
      const wireTopic = `realtime:${topic}`
      // supabase-js returns an existing channel for the same topic and would
      // append another broadcast listener. Detach the previous one first.
      for (const existing of supabase.getChannels()) {
        if (existing.topic === wireTopic) detachChannel(supabase, existing)
      }

      let everSubscribed = false
      const channel = supabase.channel(topic, {
        config: {
          broadcast: { ack: false, self: false },
          private: isPrivate,
        },
      })
      channel.on('broadcast', { event }, payload => {
        onMessage(payload)
      })
      channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') everSubscribed = true
        onStatus(mapSubscribeStatus(status, everSubscribed), err ? sanitizeStatusError(err) : undefined)
      })
      return {
        unsubscribe: () => {
          detachChannel(supabase, channel)
        },
      }
    },
  }
}

function detachChannel(supabase: SupabaseClient, channel: RealtimeChannel): void {
  const bindings = (channel as RealtimeChannel & { bindings?: Record<string, unknown[]> }).bindings
  if (bindings) bindings.broadcast = []
  const realtime = supabase.realtime as SupabaseClient['realtime'] & { _remove?: (channel: RealtimeChannel) => void }
  realtime._remove?.(channel)
  void supabase.removeChannel(channel)
}
