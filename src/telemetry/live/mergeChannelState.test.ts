import { describe, expect, it } from 'vitest'
import { mergeChannels, sessionFreshness } from './mergeChannelState'
import type { ChannelState, LiveMessage } from './types'

function message(tUs: number, values: Record<string, number>, seq = 0): LiveMessage {
  return { seq, sendTimestampMs: 1_000, tUs, values, rejectedValueCount: 0 }
}

describe('mergeChannels', () => {
  it('merges different groups and keeps equal seq values', () => {
    let state: ChannelState = {}
    const group0 = mergeChannels(state, message(5_000_000, { 'engine.rpm': 3000, 'engine.tps': 40 }, 0), 100)
    state = group0.state
    const group1 = mergeChannels(state, message(5_000_000, { 'gps.speed': 12.5 }, 0), 200)
    state = group1.state
    expect(group0.acceptedIds).toEqual(['engine.rpm', 'engine.tps'])
    expect(group1.acceptedIds).toEqual(['gps.speed'])
    expect(state['engine.rpm'].value).toBe(3000)
    expect(state['gps.speed'].value).toBe(12.5)
    expect(state['engine.rpm'].tUs).toBe(5_000_000)
  })

  it('does not replace the whole state and does not zero missing channels', () => {
    const first = mergeChannels({}, message(1, { 'engine.rpm': 3000, 'engine.oil_temp': 90 }), 10)
    const second = mergeChannels(first.state, message(2, { 'engine.rpm': 3100 }), 20)
    expect(second.state['engine.rpm'].value).toBe(3100)
    expect(second.state['engine.oil_temp'].value).toBe(90)
    expect(second.state['engine.oil_temp'].tUs).toBe(1)
    expect(second.state['brake.front_pressure']).toBeUndefined()
  })

  it('ignores duplicate and older samples without refreshing their receipt time', () => {
    const first = mergeChannels({}, message(10, { 'engine.rpm': 3000 }), 1_000)
    const duplicate = mergeChannels(first.state, message(10, { 'engine.rpm': 9999 }), 9_000)
    const older = mergeChannels(first.state, message(9, { 'engine.rpm': 1 }), 9_500)
    expect(duplicate.acceptedIds).toEqual([])
    expect(duplicate.ignoredOldCount).toBe(1)
    expect(duplicate.state['engine.rpm']).toEqual(first.state['engine.rpm'])
    expect(older.ignoredOldCount).toBe(1)
    expect(older.state['engine.rpm'].receivedAtMs).toBe(1_000)
  })

  it('accepts a newer sample and a same-timestamp update of a different channel', () => {
    const first = mergeChannels({}, message(10, { 'engine.rpm': 3000 }), 1_000)
    const newer = mergeChannels(first.state, message(11, { 'engine.rpm': 3200 }), 2_000)
    expect(newer.state['engine.rpm']).toEqual({ value: 3200, tUs: 11, receivedAtMs: 2_000 })
  })

  it('keeps finite siblings when other values were already rejected by the parser', () => {
    const merged = mergeChannels({}, {
      seq: 0,
      sendTimestampMs: 1,
      tUs: 50,
      values: { 'engine.rpm': 4100 },
      rejectedValueCount: 2,
    }, 30)
    expect(merged.acceptedIds).toEqual(['engine.rpm'])
    expect(merged.rejectedValueCount).toBe(2)
    expect(merged.state['engine.tps']).toBeUndefined()
  })
})

describe('sessionFreshness', () => {
  it('is no-data until a sample is accepted, then stale after the threshold', () => {
    expect(sessionFreshness({}, 10_000, 3_500)).toBe('no-data')
    const state = mergeChannels({}, message(1, { 'engine.rpm': 1 }), 1_000).state
    expect(sessionFreshness(state, 4_000, 3_500)).toBe('fresh')
    expect(sessionFreshness(state, 4_501, 3_500)).toBe('stale')
  })

  it('does not treat an ignored duplicate as a fresh receipt', () => {
    const first = mergeChannels({}, message(1, { 'engine.rpm': 1 }), 1_000)
    const duplicate = mergeChannels(first.state, message(1, { 'engine.rpm': 1 }), 9_000)
    expect(sessionFreshness(duplicate.state, 5_000, 3_500)).toBe('stale')
  })
})
