import { describe, expect, it } from 'vitest'
import { channelsToFrame, gpsPosition, sessionStartUs } from './mapToFrame'
import { mergeChannels } from './mergeChannelState'
import type { ChannelState, LiveMessage } from './types'

function put(state: ChannelState, tUs: number, values: Record<string, number>, receivedAtMs = 1): ChannelState {
  const message: LiveMessage = { seq: 0, sendTimestampMs: 1, tUs, values, rejectedValueCount: 0 }
  return mergeChannels(state, message, receivedAtMs).state
}

describe('channelsToFrame', () => {
  it('maps known channels, converts oil pressure kPa to bar, and leaves unknowns out of the frame fields', () => {
    let state: ChannelState = {}
    state = put(state, 2_000_000, {
      'drivetrain.vehicle_speed': 86.2,
      'engine.rpm': 5420,
      'engine.tps': 74.1,
      'brake.front_pressure': 40,
      'engine.gear': 3,
    })
    state = put(state, 1_000_000, {
      'engine.oil_pressure': 451,
      'engine.battery_voltage': 13.62,
      'engine.water_temp': 91.4,
      'engine.oil_temp': 98.2,
      'gps.speed': 24,
      'brake.rear_pressure': 12,
    })
    const mapped = channelsToFrame(state, sessionStartUs(state))
    expect(mapped.frame.speed).toBe(86.2)
    expect(mapped.frame.rpm).toBe(5420)
    expect(mapped.frame.throttle).toBe(74.1)
    expect(mapped.frame.brake).toBe(40)
    expect(mapped.frame.gear).toBe(3)
    expect(mapped.frame.oilPress).toBeCloseTo(4.51)
    expect(mapped.frame.volt).toBe(13.62)
    expect(mapped.frame.coolant).toBe(91.4)
    expect(mapped.frame.t).toBeCloseTo(1)
    expect(mapped.frame.fuel).toBeNaN()
    expect(mapped.frame.wFL).toBeNaN()
    expect(mapped.frame.suspFL).toBeNaN()
    expect(mapped.frame.lapTime).toBeNaN()
    expect(mapped.unavailableFields).toContain('fuel')
    expect(mapped.unavailableFields).toContain('wFL')
    expect(mapped.unmappedChannels).toContain('gps.speed')
    expect(mapped.unmappedChannels).toContain('brake.rear_pressure')
    expect(mapped.unmappedChannels).not.toContain('engine.rpm')
  })

  it('does not fabricate GPS position from a partial delta pair', () => {
    const partial = put({}, 1, { 'gps.lat_ref': 33.42, 'gps.lon_ref': -111.93 })
    expect(gpsPosition(partial)).toBeNull()
    const full = put(partial, 2, { 'gps.lat_d': 0.002, 'gps.lon_d': -0.001 })
    const gps = gpsPosition(full)
    expect(gps).not.toBeNull()
    expect(gps!.lat).toBeCloseTo(33.422, 6)
    expect(gps!.lon).toBeCloseTo(-111.931, 6)
  })

  it('does not treat a missing mapped channel as zero', () => {
    const mapped = channelsToFrame(put({}, 1, { 'engine.rpm': 1000 }), 1)
    expect(mapped.frame.speed).toBeNaN()
    expect(mapped.frame.throttle).toBeNaN()
    expect(mapped.unavailableFields).toContain('speed')
  })
})
