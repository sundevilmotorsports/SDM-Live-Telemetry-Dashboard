import type { ChannelState, DataFreshness, LiveMessage, MergeResult } from './types'

/**
 * Merge one partial broadcast into channel state.
 *
 * seq is intentionally unused: it is scoped to a channel group, so equal seq
 * values across groups are not duplicates. A retried frame with the same
 * t_us is ignored. Missing keys are left untouched — they are not zeros.
 * Updates whose t_us is older than or equal to the stored sample are ignored,
 * so a duplicate cannot make a stale sample look fresh.
 */
export function mergeChannels(
  state: ChannelState,
  message: LiveMessage,
  receivedAtMs: number,
): MergeResult {
  const acceptedIds: string[] = []
  let ignoredOldCount = 0
  let next = state

  for (const [id, value] of Object.entries(message.values)) {
    const prev = state[id]
    if (prev && message.tUs <= prev.tUs) {
      ignoredOldCount++
      continue
    }
    if (next === state) next = { ...state }
    next[id] = { value, tUs: message.tUs, receivedAtMs }
    acceptedIds.push(id)
  }

  return {
    state: next,
    acceptedIds,
    ignoredOldCount,
    rejectedValueCount: message.rejectedValueCount,
  }
}

export function latestAcceptedReceiptMs(state: ChannelState): number | null {
  let latest: number | null = null
  for (const sample of Object.values(state)) {
    if (latest === null || sample.receivedAtMs > latest) latest = sample.receivedAtMs
  }
  return latest
}

/**
 * Freshness follows the newest *accepted* local receipt, not the last socket
 * message. Duplicate and older broadcasts do not refresh it.
 */
export function sessionFreshness(
  state: ChannelState,
  nowMs: number,
  staleAfterMs: number,
): DataFreshness {
  const latest = latestAcceptedReceiptMs(state)
  if (latest === null) return 'no-data'
  if (nowMs - latest > staleAfterMs) return 'stale'
  return 'fresh'
}

export function channelFreshness(
  state: ChannelState,
  channelId: string,
  nowMs: number,
  staleAfterMs: number,
): DataFreshness {
  const sample = state[channelId]
  if (!sample) return 'no-data'
  if (nowMs - sample.receivedAtMs > staleAfterMs) return 'stale'
  return 'fresh'
}
