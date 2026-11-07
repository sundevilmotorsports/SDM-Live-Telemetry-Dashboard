import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isPublishableKey, normalizeSupabaseUrl } from '../live/broadcastClient'
import { getSupabaseClient } from '../live/supabaseBroadcast'

export type AuthStatus = 'misconfigured' | 'loading' | 'signed-out' | 'signed-in'

export interface SupabaseAuth {
  status: AuthStatus
  email: string | null
  /** The shared client; its auth session is what authorizes RLS reads and the session RPCs. */
  client: SupabaseClient | null
}

/** Follows the shared client's Supabase Auth session. Never touches keys beyond getSupabaseClient. */
export function useSupabaseAuth(url: string, anonKey: string): SupabaseAuth {
  const client = useMemo(() => {
    if (!normalizeSupabaseUrl(url) || !isPublishableKey(anonKey)) return null
    try { return getSupabaseClient(url, anonKey) } catch { return null }
  }, [url, anonKey])
  const [state, setState] = useState<{ client: SupabaseClient | null; email: string | null; ready: boolean }>(
    { client: null, email: null, ready: false },
  )

  useEffect(() => {
    if (!client) { setState({ client: null, email: null, ready: false }); return }
    let stopped = false
    setState({ client, email: null, ready: false })
    void client.auth.getSession().then(({ data }) => {
      if (!stopped) setState({ client, email: data.session?.user.email ?? (data.session ? 'signed-in user' : null), ready: true })
    })
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (!stopped) setState({ client, email: session?.user.email ?? (session ? 'signed-in user' : null), ready: true })
    })
    return () => { stopped = true; data.subscription.unsubscribe() }
  }, [client])

  if (!client) return { status: 'misconfigured', email: null, client: null }
  if (state.client !== client || !state.ready) return { status: 'loading', email: null, client }
  return { status: state.email ? 'signed-in' : 'signed-out', email: state.email, client }
}
