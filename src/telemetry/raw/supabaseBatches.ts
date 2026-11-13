import { sanitizeStatusError } from '../live/broadcastClient'
import { getSupabaseClient } from '../live/supabaseBroadcast'
import { RAW_BOOTSTRAP_LIMIT, RAW_PAGE_LIMIT, type RawBatchClient } from './RawBatchSession'

export const CAN_BATCH_SCHEMA = 'telemetry'
export const CAN_BATCH_TABLE = 'can_batches'

/**
 * Poll telemetry.can_batches for one session using the shared client, never Realtime.
 * Reads require a signed-in user (RLS grants SELECT to `authenticated` only).
 */
export function createSupabaseBatchClient(url: string, key: string, sessionId: string): RawBatchClient {
  if (!sessionId.trim()) throw new Error('sessionId must be nonempty')
  const supabase = getSupabaseClient(url, key)
  return {
    async fetchPage({ afterId, signal }): Promise<unknown[]> {
      try {
        const limit = afterId === null ? RAW_BOOTSTRAP_LIMIT : RAW_PAGE_LIMIT
        let query = supabase
          .schema(CAN_BATCH_SCHEMA)
          .from(CAN_BATCH_TABLE)
          // Casting on the server is essential: int8 JSON numbers can silently round.
          .select('id::text,session_id,device_id,seq,dropped_frames,frames,sent_at')
          .eq('session_id', sessionId)
          // Oldest first from the session start, then catch up after the cursor.
          .order('id', { ascending: true })
          .limit(limit)
        if (afterId !== null) query = query.gt('id', afterId)
        const { data, error } = await query.abortSignal(signal)
        if (error) throw new Error(error.message)
        if (!Array.isArray(data)) throw new Error('Invalid raw batch response: expected a non-null data array')
        if (data.length > limit) throw new Error(`Invalid raw batch response: exceeds ${limit}-row limit`)
        return data
      } catch (error) {
        throw new Error(sanitizeStatusError(error))
      }
    },
  }
}
